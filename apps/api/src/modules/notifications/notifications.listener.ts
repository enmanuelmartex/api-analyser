import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import type {
  ReportFailedEvent,
  ReportGeneratedEvent,
  ScanCompletedEvent,
  ScanFailedEvent,
  ScheduleRunFailedEvent,
  SecurityWarningEvent,
  SystemErrorEvent,
} from '../events/domain-events';

/**
 * Renders a severity breakdown as "2 Critical, 3 High, 4 Medium".
 *
 * Zero-count severities are dropped rather than printed as "0 Critical": the
 * line exists to say what was found, and listing what was not found makes the
 * important part harder to read at a glance.
 */
function describeSeverities(counts: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}): string {
  return (
    [
      [counts.critical, 'Critical'],
      [counts.high, 'High'],
      [counts.medium, 'Medium'],
      [counts.low, 'Low'],
      [counts.info, 'Info'],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(', ');
}

/**
 * Turns domain events into notifications.
 *
 * The counterpart of AuditEventsListener, consuming the same events
 * independently. Neither knows the other exists, so a change to what gets
 * logged cannot change what gets notified.
 *
 * Note what is NOT here: no generic "warning" handler. Every trivial warning
 * becoming a notification is how a notification centre stops being read, so a
 * producer must opt in explicitly with `notify: true`, and the routine
 * findings a scan produces are summarised in the scan's own notification rather
 * than raised one by one.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private notifications: NotificationsService) {}

  /**
   * A scan finished.
   *
   * The notification is addressed to the project's owner whether the scan was
   * started by hand or by a schedule — an unattended run is precisely the one
   * whose result they need telling about. What changes is the wording: a
   * scheduled run names the schedule, so "why did this scan happen?" is
   * answered by the notification itself.
   *
   * Note the difference from the audit trail, which drops the user for an
   * automatic run: an audit record answers "who did this", a notification
   * answers "who needs to know". They are not the same question.
   */
  @OnEvent('scan.completed')
  async onScanCompleted(payload: ScanCompletedEvent) {
    if (!payload.userId) return;

    const scheduled = payload.trigger === 'SCHEDULED' && Boolean(payload.scheduleName);

    const summary =
      payload.findingsCount === 0
        ? 'No findings were detected.'
        : `${payload.findingsCount} finding${payload.findingsCount === 1 ? '' : 's'}` +
          (payload.criticalCount > 0 ? `, ${payload.criticalCount} critical` : '');

    await this.safely(() =>
      this.notifications.create({
        userId: payload.userId!,
        // A completed scan is INFO even when it found something: the scan itself
        // succeeded. The severity of what it found belongs to the finding, and
        // is carried by the two notifications below.
        type: scheduled ? 'SCHEDULED_SCAN_COMPLETED' : 'SCAN_COMPLETED',
        title: scheduled
          ? `${payload.scheduleName} completed successfully`
          : `Scan completed — ${payload.projectName}`,
        message: scheduled ? `${payload.projectName} — ${summary}` : summary,
        entityType: 'assessment',
        entityId: payload.assessmentId,
        href: `/assessments/${payload.assessmentId}`,
      }),
    );

    /*
     * One notification for everything the scan found, not one per finding.
     *
     * A scan that turns up 120 findings must produce a single line saying so
     * with its breakdown — "120 new issues detected · 2 Critical, 8 High, …" —
     * because 120 separate notifications is not a notification centre, it is a
     * denial of service against the person reading it. The per-severity detail
     * lives in the message; the individual findings live in Issues, which this
     * links to filtered by the scan.
     */
    if (payload.findingsCount > 0) {
      const breakdown = describeSeverities({
        critical: payload.criticalCount,
        high: payload.highCount,
        medium: payload.mediumCount ?? 0,
        low: payload.lowCount ?? 0,
        info: payload.infoCount ?? 0,
      });

      await this.safely(() =>
        this.notifications.create({
          userId: payload.userId!,
          type: 'NEW_FINDINGS',
          title: `${payload.findingsCount} new issue${payload.findingsCount === 1 ? '' : 's'} detected`,
          message: breakdown
            ? `${payload.projectName} — ${breakdown}`
            : `${payload.projectName} — see Issues for details.`,
          entityType: 'assessment',
          entityId: payload.assessmentId,
          href: `/issues?assessmentId=${payload.assessmentId}`,
        }),
      );
    }

    // A separate, higher-severity notification when the scan found something
    // that warrants immediate attention. Gated on its own preference so a user
    // can keep these and mute routine completions.
    if (payload.criticalCount > 0) {
      await this.safely(() =>
        this.notifications.create({
          userId: payload.userId!,
          type: 'CRITICAL_FINDING',
          title: `${payload.criticalCount} critical finding${payload.criticalCount === 1 ? '' : 's'}`,
          message: scheduled
            ? `${payload.scheduleName} detected ${payload.criticalCount} critical ` +
              `vulnerabilit${payload.criticalCount === 1 ? 'y' : 'ies'} in ${payload.projectName}.`
            : `${payload.projectName} has critical issues that need review.`,
          entityType: 'assessment',
          entityId: payload.assessmentId,
          href: `/issues?assessmentId=${payload.assessmentId}&severity=CRITICAL`,
        }),
      );
    }
  }

  @OnEvent('scan.failed')
  async onScanFailed(payload: ScanFailedEvent) {
    if (!payload.userId) return;

    const scheduled = payload.trigger === 'SCHEDULED' && Boolean(payload.scheduleName);

    await this.safely(() =>
      this.notifications.create({
        userId: payload.userId!,
        type: scheduled ? 'SCHEDULED_SCAN_FAILED' : 'SCAN_FAILED',
        title: scheduled ? `${payload.scheduleName} failed` : `Scan failed — ${payload.projectName}`,
        message: scheduled ? `${payload.projectName} — ${payload.reason}` : payload.reason,
        entityType: 'assessment',
        entityId: payload.assessmentId,
        href: `/assessments/${payload.assessmentId}`,
      }),
    );
  }

  /**
   * The scheduler could not start a scan at all.
   *
   * Worth notifying because there is no assessment to notice the absence of:
   * without this, a schedule whose project lost its specification simply stops
   * producing scans, and nobody finds out until somebody looks.
   *
   * Deliberately NOT notified: a skipped run. Skipping is the guard working as
   * intended, it is recorded as an execution and an audit event, and notifying
   * on every skip would train the recipient to ignore the ones that matter.
   */
  @OnEvent('schedule.run.failed')
  async onScheduleRunFailed(payload: ScheduleRunFailedEvent) {
    if (!payload.userId) return;

    await this.safely(() =>
      this.notifications.create({
        userId: payload.userId!,
        type: 'SCHEDULED_SCAN_FAILED',
        title: `${payload.scheduleName} could not start`,
        message:
          `${payload.projectName} — ${payload.reason} ` +
          'The schedule is still active and will try again at its next run.',
        entityType: 'scheduled_scan',
        entityId: payload.scheduleId,
        href: `/scheduled-scans/${payload.scheduleId}`,
      }),
    );
  }

  /**
   * A report finished generating and its bytes are on disk.
   *
   * The emitter guarantees that ordering — see AutoReportService.markCompleted —
   * so this never announces a report that cannot be opened.
   */
  @OnEvent('report.generated')
  async onReportGenerated(payload: ReportGeneratedEvent) {
    if (!payload.userId) return;

    const automatic = payload.kind === 'AUTOMATIC_SCAN_REPORT';

    await this.safely(() =>
      this.notifications.create({
        userId: payload.userId!,
        type: 'REPORT_GENERATED',
        title: 'Report ready',
        message: automatic
          ? `Security report for "${payload.projectName ?? 'your project'}" is ready.`
          : `The ${payload.reportType.toLowerCase()} report` +
            (payload.projectName ? ` for ${payload.projectName}` : '') +
            ` is available as ${payload.format}.`,
        entityType: 'report',
        entityId: payload.reportId,
        // Deep-links to the report itself rather than the list. The list is
        // paginated and ordered by date, so "open the thing I was told about"
        // was a search once more than a page of reports existed.
        href: `/reports/${payload.reportId}`,
      }),
    );
  }

  /**
   * Every retry is exhausted and the report is not coming.
   *
   * This is the notification that stops a failed automatic PDF from being
   * invisible. Without it the user's only evidence is a report that never
   * appears in a list, which is indistinguishable from one that was never
   * meant to exist.
   */
  @OnEvent('report.failed')
  async onReportFailed(payload: ReportFailedEvent) {
    if (!payload.userId) return;

    await this.safely(() =>
      this.notifications.create({
        userId: payload.userId!,
        type: 'REPORT_FAILED',
        title: 'Report generation failed',
        message:
          `The ${payload.format} report` +
          (payload.projectName ? ` for ${payload.projectName}` : '') +
          ` could not be generated after ${payload.attempts} attempt` +
          `${payload.attempts === 1 ? '' : 's'}. You can regenerate it from the scan.`,
        entityType: 'report',
        entityId: payload.reportId,
        href: `/assessments/${payload.assessmentId}`,
      }),
    );
  }

  @OnEvent('security.warning')
  async onSecurityWarning(payload: SecurityWarningEvent) {
    if (!payload.notify) return;

    await this.safely(() =>
      this.notifications.createForAdmins({
        type: 'SECURITY_WARNING',
        // The only genuine severity override in this file: a security warning
        // carries its own, since the producer knows whether it is a routine
        // failed login or something that needs waking somebody up.
        severity: payload.severity ?? 'WARNING',
        title: 'Security warning',
        message: payload.message,
        entityType: payload.resource,
        entityId: payload.resourceId,
      }),
    );
  }

  @OnEvent('system.error')
  async onSystemError(payload: SystemErrorEvent) {
    if (!payload.notify) return;

    await this.safely(() =>
      this.notifications.createForAdmins({
        type: 'SYSTEM_ERROR',
        category: 'SYSTEM',
        severity: 'ERROR',
        title: 'System error',
        message: payload.message,
        entityType: payload.resource,
      }),
    );
  }

  /**
   * A failure to notify must never propagate back into the emitter.
   *
   * These handlers run on the same tick as the code that emitted the event —
   * the scanner finishing a job, a report being written. An exception thrown
   * here would surface as a failure of that operation, so a notification
   * problem would present as a failed scan.
   */
  private async safely(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (err) {
      this.logger.error(`Failed to create notification: ${(err as Error).message}`);
    }
  }
}
