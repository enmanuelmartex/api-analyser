import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { EmailService } from './email.service';
import { EMAIL_QUEUE, type EmailJob, type ScanFailedJob, type ScanReportReadyJob } from './email.jobs';
import {
  renderCriticalFindingEmail,
  renderScanCompletedEmail,
  renderScanFailedEmail,
} from './email-templates';

/**
 * Assembles and sends the queued messages.
 *
 * Everything that decides *whether* to send lives here rather than in the
 * listener, because the answer depends on state that can change between the
 * event and the send — a user switching email off while a job waits should not
 * still receive the message.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private prisma: PrismaService,
    private reports: ReportsService,
    private preferences: NotificationPreferencesService,
    private email: EmailService,
    private config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<EmailJob>) {
    switch (job.data.type) {
      case 'scan-report-ready':
        return this.sendReportReady(job.data);
      case 'scan-failed':
        return this.sendScanFailed(job.data);
      default: {
        // Exhaustive: a new job type added without a branch is a compile error.
        const unreachable: never = job.data;
        throw new Error(`Unknown email job: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  /**
   * "Your security scan is complete", with the report attached.
   *
   * The attachment is the artifact that was already generated and stored — read
   * off disk, never re-rendered. Printing a second PDF for the email would cost
   * another Chromium run and, worse, could differ from the one in the product if
   * the findings changed in between.
   */
  private async sendReportReady(job: ScanReportReadyJob) {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user?.isActive) {
      this.logger.log(`[Email] Skipping report email: user ${job.userId} is inactive or gone.`);
      return { skipped: 'inactive-user' };
    }

    const wantsReport = await this.preferences.wantsEmail(user.id, 'REPORT_GENERATED');
    const wantsScan = await this.preferences.wantsEmail(user.id, 'SCAN_COMPLETED');
    const wantsCritical = await this.preferences.wantsEmail(user.id, 'CRITICAL_FINDING');

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: job.assessmentId },
      select: {
        id: true,
        summary: true,
        project: { select: { id: true, name: true } },
      },
    });

    if (!assessment) return { skipped: 'assessment-gone' };

    const counts = {
      critical: assessment.summary?.criticalCount ?? 0,
      high: assessment.summary?.highCount ?? 0,
      medium: assessment.summary?.mediumCount ?? 0,
      low: assessment.summary?.lowCount ?? 0,
      info: assessment.summary?.infoCount ?? 0,
    };
    const totalFindings = assessment.summary?.totalFindings ?? 0;
    const projectName = assessment.project.name;
    const appUrl = this.config.get<string>('email.appUrl') ?? '';

    /*
     * One email, not two.
     *
     * The scan-completed message already carries the full severity breakdown,
     * so a separate "critical findings" email would be the same news twice. The
     * critical template is used only when the user has muted routine scan
     * completions but still wants to hear about critical vulnerabilities —
     * which is the one combination where the breakdown would not otherwise
     * reach them.
     */
    const sendCompletion = wantsReport || wantsScan;
    const sendCriticalOnly = !sendCompletion && wantsCritical && counts.critical > 0;

    if (!sendCompletion && !sendCriticalOnly) {
      this.logger.log(
        `[Email] Skipping report email for ${job.reportId}: the recipient's preferences do not include it.`,
      );
      return { skipped: 'preferences' };
    }

    if (sendCriticalOnly) {
      const rendered = renderCriticalFindingEmail({
        projectName,
        criticalCount: counts.critical,
        issuesUrl: `${appUrl}/issues?assessmentId=${assessment.id}&severity=CRITICAL`,
      });

      return this.email.send({
        idempotencyKey: `critical-finding:${assessment.id}:${user.id}`,
        userId: user.id,
        to: user.email,
        template: 'critical-finding',
        entityType: 'assessment',
        entityId: assessment.id,
        projectName,
        ...rendered,
      });
    }

    const idempotencyKey = `report-ready:${job.reportId}:${user.id}`;

    // Checked before reading the PDF off disk: on a retry of an already-sent
    // message there is no reason to load several megabytes to then discard it.
    // The unique index is still what guarantees correctness under a race.
    if (await this.email.alreadySent(idempotencyKey)) {
      this.logger.log(`[Email] Report ${job.reportId} was already emailed; nothing to do.`);
      return { skipped: 'already-sent' };
    }

    const { attachment, skippedReason } = await this.loadAttachment(job.reportId, user.id);

    const rendered = renderScanCompletedEmail({
      projectName,
      securityScore: assessment.summary?.securityScore ?? null,
      counts,
      totalFindings,
      reportUrl: `${appUrl}/reports/${job.reportId}`,
      attached: attachment !== null,
      attachmentSkippedReason: skippedReason,
    });

    return this.email.send({
      idempotencyKey,
      userId: user.id,
      to: user.email,
      template: 'report-ready',
      entityType: 'report',
      entityId: job.reportId,
      projectName,
      attachments: attachment ? [attachment] : undefined,
      ...rendered,
    });
  }

  private async sendScanFailed(job: ScanFailedJob) {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user?.isActive) return { skipped: 'inactive-user' };

    if (!(await this.preferences.wantsEmail(user.id, 'SCAN_FAILED'))) {
      return { skipped: 'preferences' };
    }

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: job.assessmentId },
      select: { id: true, project: { select: { name: true } } },
    });

    const projectName = assessment?.project.name ?? 'your project';
    const appUrl = this.config.get<string>('email.appUrl') ?? '';

    const rendered = renderScanFailedEmail({
      projectName,
      reason: job.reason,
      scanUrl: `${appUrl}/assessments/${job.assessmentId}`,
      scheduleName: job.scheduleName,
    });

    return this.email.send({
      idempotencyKey: `scan-failed:${job.assessmentId}:${user.id}`,
      userId: user.id,
      to: user.email,
      template: 'scan-failed',
      entityType: 'assessment',
      entityId: job.assessmentId,
      projectName,
      ...rendered,
    });
  }

  /**
   * Reads the stored PDF, if it is small enough to attach.
   *
   * A report over the configured ceiling is linked rather than attached, and the
   * email says so — silently dropping the attachment would leave the recipient
   * looking for a file the message implied was there. A read failure is treated
   * the same way: the message is worth sending without the attachment, since it
   * still carries the score, the breakdown and a working link.
   */
  private async loadAttachment(
    reportId: string,
    userId: string,
  ): Promise<{
    attachment: { filename: string; content: Buffer } | null;
    skippedReason?: string;
  }> {
    const maxBytes = this.config.get<number>('email.maxAttachmentBytes') ?? 8 * 1024 * 1024;

    const stored = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { fileSize: true, status: true },
    });

    // Belt and braces on the ordering guarantee: the job is only queued by
    // `report.generated`, which fires after COMPLETED. If that ever stops being
    // true, this refuses to attach rather than mailing a half-written file.
    if (stored?.status !== 'COMPLETED') {
      return { attachment: null, skippedReason: 'the report is still generating' };
    }

    if ((stored.fileSize ?? 0) > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      this.logger.log(
        `[Email] Report ${reportId} is ${stored.fileSize} bytes, over the ${mb}MB attachment limit; sending a link instead.`,
      );
      return { attachment: null, skippedReason: `it exceeds the ${mb}MB attachment limit` };
    }

    try {
      const artifact = await this.reports.resolveArtifact(reportId, userId);
      return { attachment: { filename: artifact.fileName, content: artifact.bytes } };
    } catch (error) {
      this.logger.warn(
        `[Email] Could not read the artifact for report ${reportId}; sending a link instead. ${(error as Error).message}`,
      );
      return { attachment: null, skippedReason: 'it could not be attached' };
    }
  }
}
