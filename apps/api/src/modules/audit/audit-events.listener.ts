import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditService } from './audit.service';
import type {
  EmailFailedEvent,
  EmailSentEvent,
  HttpErrorEvent,
  ProjectChangedEvent,
  ReportFailedEvent,
  ReportGeneratedEvent,
  ScanCancelledEvent,
  ScanCheckFinishedEvent,
  ScanCompletedEvent,
  ScanFailedEvent,
  ScanQueuedEvent,
  ScanStartedEvent,
  ScheduleChangedEvent,
  ScheduleRunFailedEvent,
  ScheduleRunSkippedEvent,
  ScheduleRunStartedEvent,
  SecurityWarningEvent,
  SettingsChangedEvent,
  SystemErrorEvent,
} from '../events/domain-events';

/**
 * How a scan event is attributed.
 *
 * An automatic run legitimately executes under the project owner's account —
 * their per-check configuration has to apply — but the audit trail must not
 * therefore claim that they started it. A scheduled run is recorded with NO
 * user and `source: scheduler`, so "what did this operator do?" never returns
 * an action they did not take. The schedule is named in the metadata, which is
 * the honest answer to "who started this".
 */
function attribution(payload: {
  trigger?: string;
  scheduleId?: string;
  scheduleName?: string;
  userId?: string;
}) {
  const scheduled = payload.trigger === 'SCHEDULED';
  return {
    userId: scheduled ? undefined : payload.userId,
    source: scheduled ? 'scheduler' : undefined,
    scheduleMeta: scheduled
      ? { trigger: 'SCHEDULED', scheduleId: payload.scheduleId, scheduleName: payload.scheduleName }
      : {},
    /** Prefix that names the schedule in the event's own message. */
    prefix: scheduled && payload.scheduleName ? `Scheduled scan "${payload.scheduleName}": ` : '',
  };
}

/**
 * Turns domain events into log entries.
 *
 * The point of routing through the event bus rather than calling AuditService
 * from each module: the scanner does not know or care that logging exists, and
 * the same `scan.failed` event is consumed independently here and by the
 * notifications listener. Adding a third consumer later touches neither
 * producer.
 */
@Injectable()
export class AuditEventsListener {
  constructor(private audit: AuditService) {}

  @OnEvent('scan.queued')
  onScanQueued(payload: ScanQueuedEvent) {
    const origin = attribution(payload);
    void this.audit.record({
      event: 'scan.queued',
      category: 'SCANS',
      severity: 'INFO',
      status: 'SUCCESS',
      action: 'CREATE',
      resource: 'assessment',
      resourceId: payload.assessmentId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: origin.userId,
      requestId: payload.requestId,
      source: origin.source ?? 'api',
      message:
        `${origin.prefix}Assessment queued for ${payload.projectName} — ` +
        `${payload.pluginCount} check${payload.pluginCount === 1 ? '' : 's'} over ` +
        `${payload.endpointCount} endpoint${payload.endpointCount === 1 ? '' : 's'}`,
      metadata: {
        endpointCount: payload.endpointCount,
        pluginCount: payload.pluginCount,
        executionMode: payload.executionMode,
        ...origin.scheduleMeta,
      },
    });
  }

  @OnEvent('scan.started')
  onScanStarted(payload: ScanStartedEvent) {
    const origin = attribution(payload);
    void this.audit.record({
      event: 'scan.started',
      category: 'SCANS',
      severity: 'INFO',
      status: 'SUCCESS',
      resource: 'assessment',
      resourceId: payload.assessmentId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: origin.userId,
      requestId: payload.requestId,
      source: origin.source ?? 'scanner-worker',
      message: `${origin.prefix}Assessment started for ${payload.projectName ?? payload.projectId} — ${payload.endpointCount} endpoint${payload.endpointCount === 1 ? '' : 's'} in scope`,
      metadata: {
        endpointCount: payload.endpointCount,
        pluginCount: payload.pluginCount,
        ...origin.scheduleMeta,
      },
    });
  }

  /**
   * One check finished.
   *
   * Severity follows the check's own outcome rather than being fixed at INFO: a
   * timeout is the single most useful thing in this stream, because a check that
   * never completed cannot resolve an issue and silently narrows coverage.
   */
  @OnEvent('scan.check.finished')
  onScanCheckFinished(payload: ScanCheckFinishedEvent) {
    const failed = payload.status !== 'SUCCESS';
    const origin = attribution(payload);
    void this.audit.record({
      event: failed ? 'scan.check.failed' : 'scan.check.completed',
      category: 'SCANS',
      severity: failed ? (payload.status === 'TIMEOUT' ? 'WARNING' : 'ERROR') : 'INFO',
      status: failed ? (payload.status === 'TIMEOUT' ? 'WARNING' : 'FAILED') : 'SUCCESS',
      resource: 'plugin',
      resourceId: payload.pluginId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: origin.userId,
      requestId: payload.requestId,
      source: origin.source ?? 'scanner-worker',
      durationMs: payload.durationMs,
      message: failed
        ? `${payload.pluginName} ${payload.status.toLowerCase()} after ${payload.durationMs}ms`
        : `${payload.pluginName} completed — ${payload.findingsCount} finding${payload.findingsCount === 1 ? '' : 's'} in ${payload.durationMs}ms`,
      metadata: {
        pluginId: payload.pluginId,
        status: payload.status,
        findingsCount: payload.findingsCount,
      },
    });
  }

  @OnEvent('scan.cancelled')
  onScanCancelled(payload: ScanCancelledEvent) {
    void this.audit.record({
      event: 'scan.cancelled',
      category: 'SCANS',
      severity: 'WARNING',
      status: 'WARNING',
      action: 'UPDATE',
      resource: 'assessment',
      resourceId: payload.assessmentId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'api',
      message: `Assessment cancelled for ${payload.projectName} at ${payload.progress}%`,
      metadata: { progress: payload.progress, currentStep: payload.currentStep ?? null },
    });
  }

  @OnEvent('project.changed')
  onProjectChanged(payload: ProjectChangedEvent) {
    void this.audit.record({
      event: `project.${payload.change}`,
      category: 'PROJECTS',
      severity: 'INFO',
      status: 'SUCCESS',
      action: payload.action,
      resource: 'project',
      resourceId: payload.projectId,
      projectId: payload.projectId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'api',
      message: payload.message,
      metadata: payload.metadata,
    });
  }

  /**
   * An error response left the API.
   *
   * Category is API rather than SYSTEM so an operator can separate "a request
   * failed" from "the process is broken" — the two have very different
   * responses, and mixing them makes the SYSTEM category useless as a signal.
   */
  @OnEvent('http.error')
  onHttpError(payload: HttpErrorEvent) {
    const serverSide = payload.statusCode >= 500;
    void this.audit.record({
      event: serverSide ? 'http.server_error' : 'http.client_error',
      category: 'API',
      severity: serverSide ? 'ERROR' : 'WARNING',
      status: serverSide ? 'FAILED' : 'WARNING',
      resource: 'request',
      userId: payload.userId,
      requestId: payload.requestId,
      ipAddress: payload.ipAddress,
      source: 'api',
      httpMethod: payload.method,
      route: payload.route,
      statusCode: payload.statusCode,
      durationMs: payload.durationMs,
      errorCode: payload.errorCode,
      stackTrace: payload.stackTrace,
      message:
        `${payload.method} ${payload.route} — ${payload.statusCode} ${payload.message}` +
        (payload.repeatedCount
          ? ` (and ${payload.repeatedCount} more identical failure${payload.repeatedCount === 1 ? '' : 's'} just before this)`
          : ''),
      metadata: payload.repeatedCount ? { repeatedCount: payload.repeatedCount } : undefined,
    });
  }

  /**
   * A scan finished.
   *
   * Two events are written when a schedule was behind it: this one, about the
   * assessment, and `scheduled_scan.completed` below, about the schedule. They
   * are not redundant — an operator reviewing a schedule filters on the second,
   * and one filtered on `scan.completed` would also return every manual run.
   */
  @OnEvent('scan.completed')
  onScanCompleted(payload: ScanCompletedEvent) {
    const origin = attribution(payload);
    void this.audit.record({
      event: 'scan.completed',
      category: 'SCANS',
      severity: 'INFO',
      status: 'SUCCESS',
      resource: 'assessment',
      resourceId: payload.assessmentId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: origin.userId,
      requestId: payload.requestId,
      source: origin.source ?? 'scanner-worker',
      durationMs: payload.durationMs,
      message: `${origin.prefix}Scan completed for ${payload.projectName} — ${payload.findingsCount} finding${payload.findingsCount === 1 ? '' : 's'}`,
      metadata: {
        findingsCount: payload.findingsCount,
        criticalCount: payload.criticalCount,
        highCount: payload.highCount,
        securityScore: payload.securityScore,
        ...origin.scheduleMeta,
      },
    });

    if (payload.trigger === 'SCHEDULED') {
      void this.audit.record({
        event: 'scheduled_scan.completed',
        category: 'SCANS',
        severity: 'INFO',
        status: 'SUCCESS',
        resource: 'scheduled_scan',
        resourceId: payload.scheduleId,
        assessmentId: payload.assessmentId,
        projectId: payload.projectId,
        source: 'scheduler',
        durationMs: payload.durationMs,
        message:
          `Scheduled scan "${payload.scheduleName ?? payload.scheduleId}" completed for ` +
          `${payload.projectName} — ${payload.findingsCount} finding${payload.findingsCount === 1 ? '' : 's'}`,
        metadata: {
          scheduleId: payload.scheduleId,
          scheduleName: payload.scheduleName,
          findingsCount: payload.findingsCount,
          criticalCount: payload.criticalCount,
          securityScore: payload.securityScore,
        },
      });
    }
  }

  @OnEvent('scan.failed')
  onScanFailed(payload: ScanFailedEvent) {
    const origin = attribution(payload);
    void this.audit.record({
      event: 'scan.failed',
      category: 'SCANS',
      severity: 'ERROR',
      status: 'FAILED',
      resource: 'assessment',
      resourceId: payload.assessmentId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: origin.userId,
      requestId: payload.requestId,
      source: origin.source ?? 'scanner-worker',
      durationMs: payload.durationMs,
      errorCode: payload.errorCode,
      stackTrace: payload.stackTrace,
      message: `${origin.prefix}Scan failed for ${payload.projectName}: ${payload.reason}`,
      metadata: { reason: payload.reason, ...origin.scheduleMeta },
    });

    if (payload.trigger === 'SCHEDULED') {
      void this.audit.record({
        event: 'scheduled_scan.failed',
        category: 'SCANS',
        severity: 'ERROR',
        status: 'FAILED',
        resource: 'scheduled_scan',
        resourceId: payload.scheduleId,
        assessmentId: payload.assessmentId,
        projectId: payload.projectId,
        source: 'scheduler',
        message:
          `Scheduled scan "${payload.scheduleName ?? payload.scheduleId}" failed for ` +
          `${payload.projectName}: ${payload.reason}`,
        metadata: {
          scheduleId: payload.scheduleId,
          scheduleName: payload.scheduleName,
          reason: payload.reason,
          // Stated in the record itself so an operator reading a failure is not
          // left wondering whether the automation stopped with it.
          scheduleRemainsActive: true,
        },
      });
    }
  }

  // ── Scheduled scans ───────────────────────────────────────────────────────

  /**
   * Lifecycle changes to a schedule: created, updated, paused, resumed,
   * deleted, run by hand.
   *
   * These DO carry a user: an operator really did make the change, unlike the
   * automatic runs above.
   */
  @OnEvent('schedule.changed')
  onScheduleChanged(payload: ScheduleChangedEvent) {
    void this.audit.record({
      event: `scheduled_scan.${payload.change}`,
      category: 'SCANS',
      severity: payload.change === 'deleted' ? 'WARNING' : 'INFO',
      status: 'SUCCESS',
      action: payload.action,
      resource: 'scheduled_scan',
      resourceId: payload.scheduleId,
      projectId: payload.projectId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'api',
      message: payload.message,
      metadata: {
        scheduleId: payload.scheduleId,
        scheduleName: payload.scheduleName,
        projectName: payload.projectName,
        ...payload.metadata,
      },
    });
  }

  @OnEvent('schedule.run.started')
  onScheduleRunStarted(payload: ScheduleRunStartedEvent) {
    void this.audit.record({
      event: 'scheduled_scan.started',
      category: 'SCANS',
      severity: 'INFO',
      status: 'SUCCESS',
      resource: 'scheduled_scan',
      resourceId: payload.scheduleId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      // No userId on an automatic run — see `attribution` above.
      source: payload.trigger === 'MANUAL' ? 'api' : 'scheduler',
      message: `Scheduled scan "${payload.scheduleName}" started an assessment for ${payload.projectName}`,
      metadata: {
        scheduleId: payload.scheduleId,
        scheduleName: payload.scheduleName,
        executionId: payload.executionId,
        scheduledFor: payload.scheduledFor.toISOString(),
        trigger: payload.trigger,
      },
    });
  }

  /**
   * An occurrence was reached and deliberately not run.
   *
   * WARNING rather than INFO: a schedule skipping repeatedly means the scan
   * takes longer than the interval, which quietly halves the coverage the
   * operator thinks they have.
   */
  @OnEvent('schedule.run.skipped')
  onScheduleRunSkipped(payload: ScheduleRunSkippedEvent) {
    void this.audit.record({
      event: 'scheduled_scan.skipped',
      category: 'SCANS',
      severity: 'WARNING',
      status: 'WARNING',
      resource: 'scheduled_scan',
      resourceId: payload.scheduleId,
      projectId: payload.projectId,
      source: 'scheduler',
      message: `Scheduled scan "${payload.scheduleName}" skipped a run for ${payload.projectName}: ${payload.reason}`,
      metadata: {
        scheduleId: payload.scheduleId,
        scheduleName: payload.scheduleName,
        executionId: payload.executionId,
        scheduledFor: payload.scheduledFor.toISOString(),
        reason: payload.reason,
      },
    });
  }

  /**
   * The scheduler could not start a scan at all.
   *
   * Distinct from `scheduled_scan.failed`, which means a scan ran and failed.
   * Here no assessment exists, so there is no `assessmentId` to correlate on —
   * which is exactly why the event has to say so explicitly.
   */
  @OnEvent('schedule.run.failed')
  onScheduleRunFailed(payload: ScheduleRunFailedEvent) {
    void this.audit.record({
      event: 'scheduled_scan.failed',
      category: 'SCANS',
      severity: 'ERROR',
      status: 'FAILED',
      resource: 'scheduled_scan',
      resourceId: payload.scheduleId,
      projectId: payload.projectId,
      source: 'scheduler',
      message: `Scheduled scan "${payload.scheduleName}" could not start a scan for ${payload.projectName}: ${payload.reason}`,
      metadata: {
        scheduleId: payload.scheduleId,
        scheduleName: payload.scheduleName,
        executionId: payload.executionId,
        scheduledFor: payload.scheduledFor.toISOString(),
        reason: payload.reason,
        consecutiveFailures: payload.consecutiveFailures,
        scheduleRemainsActive: true,
      },
    });
  }

  @OnEvent('report.generated')
  onReportGenerated(payload: ReportGeneratedEvent) {
    void this.audit.record({
      event: 'report.generated',
      category: 'REPORTS',
      severity: 'INFO',
      status: 'SUCCESS',
      resource: 'report',
      resourceId: payload.reportId,
      reportId: payload.reportId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: payload.userId,
      requestId: payload.requestId,
      // An automatic report is the system's work, not the user's. The owner is
      // still recorded — the artifact is theirs — but the source says who acted,
      // which is what distinguishes "exported a report" from "was sent one".
      source: payload.kind === 'AUTOMATIC_SCAN_REPORT' ? 'worker' : 'api',
      message:
        payload.kind === 'AUTOMATIC_SCAN_REPORT'
          ? `Automatic ${payload.format} report generated for the completed scan`
          : `${payload.reportType} report generated as ${payload.format}`,
      metadata: { format: payload.format, type: payload.reportType, kind: payload.kind },
    });
  }

  /**
   * A report could not be generated, after every retry.
   *
   * Recorded as an ERROR against the report so the technical trail shows the
   * artifact was owed and never produced. The user-facing half of this is a
   * REPORT_FAILED notification, raised independently by the notifications
   * listener — the audit log is the record, the notification is the message.
   */
  @OnEvent('report.failed')
  onReportFailed(payload: ReportFailedEvent) {
    void this.audit.record({
      event: 'report.generation.failed',
      category: 'REPORTS',
      severity: 'ERROR',
      status: 'FAILED',
      resource: 'report',
      resourceId: payload.reportId,
      reportId: payload.reportId,
      assessmentId: payload.assessmentId,
      projectId: payload.projectId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'worker',
      message: `${payload.format} report generation failed after ${payload.attempts} attempt(s): ${payload.reason}`,
      metadata: {
        format: payload.format,
        type: payload.reportType,
        kind: payload.kind,
        attempts: payload.attempts,
      },
    });
  }

  @OnEvent('email.sent')
  onEmailSent(payload: EmailSentEvent) {
    void this.audit.record({
      event: 'report.email.sent',
      category: 'REPORTS',
      severity: 'INFO',
      status: 'SUCCESS',
      resource: payload.entityType ?? 'email',
      resourceId: payload.entityId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'worker',
      message: `The ${payload.template} email was accepted by the provider`,
      // The recipient's address is deliberately absent: the delivery row holds
      // it, and duplicating personal data into a second table with its own
      // retention policy is not something an audit trail needs to do.
      metadata: { template: payload.template, providerMessageId: payload.providerMessageId },
    });
  }

  @OnEvent('email.failed')
  onEmailFailed(payload: EmailFailedEvent) {
    void this.audit.record({
      event: 'report.email.failed',
      category: 'REPORTS',
      severity: 'WARNING',
      status: 'FAILED',
      resource: payload.entityType ?? 'email',
      resourceId: payload.entityId,
      userId: payload.userId,
      requestId: payload.requestId,
      source: 'worker',
      // WARNING, not ERROR: the work the email was about succeeded, and the
      // report is still in the product. Only its delivery failed.
      message: `The ${payload.template} email could not be delivered: ${payload.reason}`,
      metadata: { template: payload.template },
    });
  }

  @OnEvent('security.warning')
  onSecurityWarning(payload: SecurityWarningEvent) {
    void this.audit.record({
      event: payload.event ?? 'security.warning',
      category: 'SECURITY',
      severity: payload.severity ?? 'WARNING',
      status: 'WARNING',
      resource: payload.resource ?? 'security',
      resourceId: payload.resourceId,
      userId: payload.userId,
      ipAddress: payload.ipAddress,
      requestId: payload.requestId,
      source: payload.source ?? 'api',
      message: payload.message,
      metadata: payload.metadata,
    });
  }

  @OnEvent('system.error')
  onSystemError(payload: SystemErrorEvent) {
    void this.audit.record({
      event: payload.event ?? 'system.error',
      category: payload.category ?? 'SYSTEM',
      severity: 'ERROR',
      status: 'FAILED',
      resource: payload.resource ?? 'system',
      userId: payload.userId,
      requestId: payload.requestId,
      source: payload.source ?? 'api',
      message: payload.message,
      errorCode: payload.errorCode,
      stackTrace: payload.stackTrace,
      metadata: payload.metadata,
    });
  }

  /**
   * Records a configuration change as one event per setting.
   *
   * One event per key, not one per form submission: an investigator filtering
   * on `logs.retentionDays` must find every change to it, and a combined event
   * would hide the individual values behind a metadata blob.
   *
   * Nothing in the settings registry is a credential — the catalogue is
   * deliberately secret-free — so old and new values can be recorded verbatim,
   * which is what makes the trail useful. Should a secret ever be added there,
   * the sanitizer in AuditService still redacts the metadata by key name.
   */
  @OnEvent('settings.changed')
  onSettingsChanged(payload: SettingsChangedEvent) {
    for (const change of payload.changes) {
      void this.audit.record({
        event: 'settings.changed',
        category: 'CONFIGURATION',
        severity: 'INFO',
        status: 'SUCCESS',
        action: 'UPDATE',
        resource: 'settings',
        resourceId: change.key,
        userId: payload.actorId,
        source: 'api',
        message: `${change.key} changed from ${format(change.from)} to ${format(change.to)}`,
        metadata: { key: change.key, from: change.from, to: change.to },
      });
    }
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return 'default';
  return String(value);
}
