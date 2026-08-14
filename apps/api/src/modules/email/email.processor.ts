import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { SettingsService } from '../settings/settings.service';
import { resolveEmailTheme } from '../auth/display-preferences';
import { EmailService, maskEmail, type RelayTheme } from './email.service';
import {
  EMAIL_QUEUE,
  type EmailJob,
  type ScanFailedJob,
  type ScanReportReadyJob,
  type WeeklySummaryJob,
} from './email.jobs';
import {
  renderCriticalFindingEmail,
  renderScanCompletedEmail,
  renderScanFailedEmail,
  renderWeeklySummaryEmail,
} from './email-templates';
import {
  deliveryKey,
  planRecipients,
  weeklyDeliveryKey,
  type PlannedRecipient,
} from './report-recipients';
import { calendarDateIn } from './week-range';
import { WeeklySummaryService } from './weekly-summary.service';

/** The risk levels the summary can hold, and the only ones the relay accepts. */
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Narrows the free-text `riskLevel` column to what the relay's enum accepts.
 *
 * The column is a plain string with a `"LOW"` default rather than a database
 * enum, so an older row — or one written by a future scorer — could hold
 * anything. An unrecognised value becomes `undefined`, which renders as an
 * omitted row rather than earning a 400 from the relay and losing the whole
 * email over a cosmetic field.
 */
function normaliseRiskLevel(value: string | null | undefined): RiskLevel | undefined {
  const upper = value?.toUpperCase();
  return RISK_LEVELS.includes(upper as RiskLevel) ? (upper as RiskLevel) : undefined;
}

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
    private weekly: WeeklySummaryService,
  ) {
    super();
  }

  async process(job: Job<EmailJob>) {
    switch (job.data.type) {
      case 'scan-report-ready':
        return this.sendReportReady(job.data);
      case 'scan-failed':
        return this.sendScanFailed(job.data);
      case 'weekly-summary':
        return this.sendWeeklySummary(job.data);
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
        completedAt: true,
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
    // "Evaluated" means tested, not discovered: a specification can carry
    // endpoints the run never reached, and reporting those as evaluated would
    // overstate the coverage the score was computed from.
    const endpointsEvaluated = assessment.summary?.testedEndpoints ?? undefined;
    const riskLevel = normaliseRiskLevel(assessment.summary?.riskLevel);

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

    this.logger.log(
      `[Email] Sending report ${job.reportId} to ${pending.length} recipient(s): ` +
        pending.map((recipient) => maskEmail(recipient.address)).join(', '),
    );

    /*
     * Rendered per recipient rather than once.
     *
     * The message now carries the reader's own name and their own light/dark
     * choice, so it is genuinely different per address — the project owner gets
     * "Hi Ada," in dark, while the team mailbox on `security@` gets a neutral
     * greeting in light because there is no person behind it to have a
     * preference. The expensive part is not the render: it is the PDF, which is
     * read from disk once above and shared by every send.
     */
    for (const recipient of pending) {
      const person = await this.recipientProfile(recipient, owner?.userId ?? job.userId);
      const scanDate = calendarDateIn(
        assessment.completedAt ?? new Date(),
        person.timeZone,
      );

      const rendered = renderScanCompletedEmail({
        userName: person.name,
        projectName,
        securityScore,
        riskLevel,
        counts,
        totalFindings,
        endpointsEvaluated,
        scanDate,
        reportUrl: reportUrl ?? '',
        attached: attachment !== null,
        attachmentSkippedReason: skippedReason,
      });

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
          theme: person.theme,
          relay: {
            template: 'scan-report',
            data: {
              userName: person.name,
              projectName,
              securityScore,
              riskLevel,
              counts,
              totalFindings,
              endpointsEvaluated,
              scanDate,
              reportUrl,
            },
          },
          ...rendered,
        }),
      );
    }

    return { results };
  }

  /**
   * "Your weekly summary", with the numbers computed at send time.
   *
   * The job carries a user id and a week, never the figures. A digest that sat
   * in the queue through a restart therefore reports the week as it actually
   * was, and a retry after a partial failure cannot deliver stale numbers.
   *
   * Every gate is re-checked here rather than trusted from the scheduler,
   * because a job can wait: a user who turned email off in the intervening
   * minutes must not receive one.
   */
  private async sendWeeklySummary(job: WeeklySummaryJob) {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { id: true, email: true, name: true, isActive: true, theme: true },
    });

    if (!user?.isActive || !user.email) return { skipped: 'user-unavailable' };

    if (!(await this.preferences.wantsWeeklySummary(user.id))) {
      return { skipped: 'preference-off' };
    }

    const key = weeklyDeliveryKey(job.weekStart, user.email);
    if (await this.email.alreadySent(key)) return { skipped: 'already-sent' };

    const summary = await this.weekly.compute(user.id);
    if (!summary) return { skipped: 'no-projects' };

    /*
     * A week in which nothing happened is not worth an email.
     *
     * Sending four zeroes every Monday to someone who is not currently using
     * the product is how a useful digest becomes something people filter. The
     * check is deliberately narrow — no assessments in EITHER week and no
     * active projects — so a quiet week between two busy ones still reports,
     * because "you ran nothing this week" is real information there.
     */
    if (summary.isEmpty) {
      this.logger.log(`[Weekly] Nothing to report for ${user.id}; not sending a digest.`);
      return { skipped: 'no-activity' };
    }

    const dashboardUrl = this.weekly.dashboardUrl();
    const theme = resolveEmailTheme(user.theme);

    const rendered = renderWeeklySummaryEmail({
      userName: user.name,
      dateFrom: summary.week.fromDate,
      dateTo: summary.week.toDate,
      assessments: summary.assessments,
      findings: summary.findings,
      critical: summary.critical,
      activeProjects: summary.activeProjects,
      dashboardUrl: dashboardUrl ?? '',
    });

    this.logger.log(
      `[Weekly] Sending ${summary.week.fromDate}..${summary.week.toDate} digest to ` +
        `${maskEmail(user.email)}`,
    );

    return {
      result: await this.email.send({
        idempotencyKey: key,
        userId: user.id,
        to: user.email,
        template: 'weekly-summary',
        entityType: 'user',
        entityId: user.id,
        theme,
        relay: {
          template: 'weekly-summary',
          data: {
            userName: user.name,
            dateFrom: summary.week.fromDate,
            dateTo: summary.week.toDate,
            assessments: summary.assessments,
            findings: summary.findings,
            critical: summary.critical,
            activeProjects: summary.activeProjects,
            dashboardUrl,
          },
        },
        ...rendered,
      }),
    };
  }

  /**
   * The name, zone and theme to render one copy of the message in.
   *
   * ── Identity and presentation are resolved differently, on purpose ─────────
   *
   * This used to hand every recipient without a user id the system timezone and
   * the light variant, on the reasoning that a team mailbox has nobody behind
   * it whose preference could be consulted. That reasoning holds for
   * `security@corp.example`. It is wrong for the far more common self-hosted
   * shape: one operator, whose account address is something undeliverable like
   * `admin@apianalyser.local`, who puts their real mailbox in
   * `notifications.reportRecipients`. Every email they ever receive arrives as
   * a stranger's — light, unnamed — while the application they are looking at
   * is dark.
   *
   * So the two are now resolved separately:
   *
   *   • **Presentation** — timezone and theme — falls back to the project
   *     owner. It is styling: there is no correctness risk in guessing, the
   *     owner is the only preference the installation actually holds, and it is
   *     a far better guess than a hardcoded default. A team mailbox read by
   *     five people renders in the owner's theme, which is harmless.
   *
   *   • **Identity** — the greeting name — does not. A name is a claim about
   *     who the reader is, and addressing `security@corp.example` as "Hi Ada,"
   *     is wrong in a way a colour cannot be. It is set only when the address
   *     resolves to an actual account.
   *
   * The address lookup is what makes the middle case work: a configured
   * recipient who IS a user of the installation — but not the project owner —
   * gets their own name and their own theme, not the owner's.
   */
  private async recipientProfile(
    recipient: PlannedRecipient,
    ownerId: string | undefined,
  ): Promise<{ name?: string; timeZone: string; theme: RelayTheme }> {
    const systemZone = this.systemTimeZone();

    // Attributed to a user already, by `planRecipients`.
    if (recipient.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: recipient.userId },
        select: { name: true, timeZone: true, theme: true },
      });
      if (user) {
        return {
          name: user.name || undefined,
          timeZone: user.timeZone || systemZone,
          theme: resolveEmailTheme(user.theme),
        };
      }
    }

    // A configured address that happens to belong to an account. Their own
    // preferences win over the owner's — it is their inbox.
    const byAddress = await this.prisma.user.findUnique({
      where: { email: recipient.address },
      select: { name: true, timeZone: true, theme: true, isActive: true },
    });
    if (byAddress?.isActive) {
      return {
        name: byAddress.name || undefined,
        timeZone: byAddress.timeZone || systemZone,
        theme: resolveEmailTheme(byAddress.theme),
      };
    }

    // Not an account. Style it like the owner sees the product, and greet it
    // by nobody's name.
    if (ownerId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { timeZone: true, theme: true },
      });
      if (owner) {
        return {
          timeZone: owner.timeZone || systemZone,
          theme: resolveEmailTheme(owner.theme),
        };
      }
    }

    return { timeZone: systemZone, theme: 'light' };
  }

  private systemTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
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
