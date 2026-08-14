import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService, maskEmail } from './email.service';
import { EMAIL_QUEUE, type EmailJob, type ScanFailedJob, type ScanReportReadyJob } from './email.jobs';
import {
  renderCriticalFindingEmail,
  renderScanCompletedEmail,
  renderScanFailedEmail,
} from './email-templates';
import { deliveryKey, planRecipients, type PlannedRecipient } from './report-recipients';

/**
 * The relay caps a `reason` at 1000 characters. Truncated here rather than
 * discovered as a 400 after the message has already been recorded as pending.
 */
const MAX_RELAY_REASON_CHARS = 1000;

/**
 * Assembles and sends the queued messages.
 *
 * Everything that decides *whether* to send lives here rather than in the
 * listener, because the answer depends on state that can change between the
 * event and the send — a user switching email off, or an administrator editing
 * the recipient list, while a job waits.
 *
 * Two audiences, resolved by `planRecipients`: the addresses an administrator
 * configured for the whole installation, and the project owner's own address
 * under their own preferences. One message is sent per address, each with its
 * own idempotency key, so a partial failure retries only the addresses that
 * did not get it.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private prisma: PrismaService,
    private reports: ReportsService,
    private preferences: NotificationPreferencesService,
    private settings: SettingsService,
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
   * the findings changed in between. It is read once and shared by every
   * recipient.
   */
  private async sendReportReady(job: ScanReportReadyJob) {
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
    const securityScore = assessment.summary?.securityScore ?? null;
    const projectName = assessment.project.name || 'your project';

    const owner = await this.activeOwner(job.userId);

    /*
     * One email, not two.
     *
     * The scan-completed message already carries the full severity breakdown,
     * so a separate "critical findings" email would be the same news twice. The
     * critical template is used only when the owner has muted routine scan
     * completions but still wants to hear about critical vulnerabilities —
     * which is the one combination where the breakdown would not otherwise
     * reach them. It applies to the owner alone: a configured recipient has no
     * per-user preference to have muted.
     */
    const ownerWantsCompletion = owner
      ? (await this.preferences.wantsEmail(owner.userId, 'REPORT_GENERATED')) ||
        (await this.preferences.wantsEmail(owner.userId, 'SCAN_COMPLETED'))
      : false;
    const ownerWantsCriticalOnly =
      owner !== null &&
      !ownerWantsCompletion &&
      counts.critical > 0 &&
      (await this.preferences.wantsEmail(owner.userId, 'CRITICAL_FINDING'));

    const recipients = planRecipients({
      configured: await this.settings.getList('notifications.reportRecipients'),
      installEnabled: await this.settings.getBoolean('notifications.emailOnScanCompleted'),
      owner,
      ownerWants: ownerWantsCompletion,
    });

    const results: unknown[] = [];

    if (ownerWantsCriticalOnly && owner) {
      const rendered = renderCriticalFindingEmail({
        projectName,
        criticalCount: counts.critical,
        issuesUrl: this.appUrl(`/issues?assessmentId=${assessment.id}&severity=CRITICAL`) ?? '',
      });

      results.push(
        await this.email.send({
          idempotencyKey: deliveryKey('critical-finding', assessment.id, owner.email),
          userId: owner.userId,
          to: owner.email,
          template: 'critical-finding',
          entityType: 'assessment',
          entityId: assessment.id,
          projectName,
          relay: {
            template: 'critical-finding',
            data: {
              projectName,
              criticalCount: counts.critical,
              issuesUrl: this.appUrl(
                `/issues?assessmentId=${assessment.id}&severity=CRITICAL`,
              ),
            },
          },
          ...rendered,
        }),
      );
    }

    if (recipients.length === 0) {
      if (results.length === 0) {
        this.logger.log(
          `[Email] No recipients for report ${job.reportId}: no addresses are configured ` +
            'and the owner has not enabled report email.',
        );
        return { skipped: 'no-recipients' };
      }
      return { results };
    }

    // Checked before reading the PDF off disk: on a retry where every address
    // already has the message there is no reason to load several megabytes to
    // then discard it. The unique index is still what guarantees correctness
    // under a race.
    const pending = await this.filterAlreadySent(job.reportId, recipients);
    if (pending.length === 0) {
      this.logger.log(`[Email] Report ${job.reportId} was already emailed to every recipient.`);
      return { skipped: 'already-sent', results };
    }

    const { attachment, skippedReason } = await this.loadAttachment(
      job.reportId,
      owner?.userId ?? job.userId,
    );

    const reportUrl = this.appUrl(`/reports/${job.reportId}`);

    const rendered = renderScanCompletedEmail({
      projectName,
      securityScore,
      counts,
      totalFindings,
      reportUrl: reportUrl ?? '',
      attached: attachment !== null,
      attachmentSkippedReason: skippedReason,
    });

    this.logger.log(
      `[Email] Sending report ${job.reportId} to ${pending.length} recipient(s): ` +
        pending.map((recipient) => maskEmail(recipient.address)).join(', '),
    );

    for (const recipient of pending) {
      results.push(
        await this.email.send({
          idempotencyKey: deliveryKey('report-ready', job.reportId, recipient.address),
          userId: recipient.userId,
          to: recipient.address,
          template: 'report-ready',
          entityType: 'report',
          entityId: job.reportId,
          projectName,
          attachments: attachment ? [attachment] : undefined,
          relay: {
            template: 'scan-report',
            data: {
              projectName,
              securityScore,
              counts,
              totalFindings,
              reportUrl,
            },
          },
          ...rendered,
        }),
      );
    }

    return { results };
  }

  private async sendScanFailed(job: ScanFailedJob) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: job.assessmentId },
      select: { id: true, project: { select: { name: true } } },
    });

    const projectName = assessment?.project.name || 'your project';
    const owner = await this.activeOwner(job.userId);

    const recipients = planRecipients({
      configured: await this.settings.getList('notifications.reportRecipients'),
      installEnabled: await this.settings.getBoolean('notifications.emailOnScanFailed'),
      owner,
      ownerWants: owner
        ? await this.preferences.wantsEmail(owner.userId, 'SCAN_FAILED')
        : false,
    });

    if (recipients.length === 0) return { skipped: 'no-recipients' };

    const scanUrl = this.appUrl(`/assessments/${job.assessmentId}`);
    const reason = job.reason.slice(0, MAX_RELAY_REASON_CHARS);

    const rendered = renderScanFailedEmail({
      projectName,
      reason: job.reason,
      scanUrl: scanUrl ?? '',
      scheduleName: job.scheduleName,
    });

    const results = [];
    for (const recipient of recipients) {
      results.push(
        await this.email.send({
          idempotencyKey: deliveryKey('scan-failed', job.assessmentId, recipient.address),
          userId: recipient.userId,
          to: recipient.address,
          template: 'scan-failed',
          entityType: 'assessment',
          entityId: job.assessmentId,
          projectName,
          relay: {
            template: 'scan-failed',
            data: { projectName, reason, scanUrl, scheduleName: job.scheduleName },
          },
          ...rendered,
        }),
      );
    }

    return { results };
  }

  /** The project owner, when they still exist, are active and have an address. */
  private async activeOwner(userId: string | undefined) {
    if (!userId) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user?.isActive || !user.email) {
      if (userId) {
        this.logger.log(
          `[Email] Project owner ${userId} is inactive, gone, or has no address; ` +
            'configured recipients are unaffected.',
        );
      }
      return null;
    }

    return { userId: user.id, email: user.email };
  }

  /** Drops the addresses that already have this report. */
  private async filterAlreadySent(
    reportId: string,
    recipients: readonly PlannedRecipient[],
  ): Promise<PlannedRecipient[]> {
    const pending: PlannedRecipient[] = [];

    for (const recipient of recipients) {
      const sent = await this.email.alreadySent(
        deliveryKey('report-ready', reportId, recipient.address),
      );
      if (!sent) pending.push(recipient);
    }

    return pending;
  }

  /**
   * An absolute link into this installation, or nothing.
   *
   * Nothing when `APP_URL`/`FRONTEND_URL` is unset or is not an absolute URL:
   * the relay rejects a relative link with a 400, and a broken `/reports/abc`
   * in an email helps nobody either way. The templates render the link only
   * when there is one.
   */
  private appUrl(path: string): string | undefined {
    const base = this.config.get<string>('email.appUrl') ?? '';
    if (!base) return undefined;

    try {
      const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
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
    userId: string | undefined,
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

    // The artifact reader authorises against a user. Configured recipients are
    // frequently not users at all, so the owner's id is what is used — the
    // report belongs to their project, and the recipient list is an
    // administrator's decision rather than a permission grant.
    if (!userId) {
      return { attachment: null, skippedReason: 'it could not be attached' };
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
