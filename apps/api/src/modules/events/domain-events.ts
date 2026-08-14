import type { LogCategory, LogSeverity } from '@prisma/client';

/**
 * The internal event contract.
 *
 * Producers (the scanner worker, the reports service, guards) emit these;
 * consumers (the audit writer, the notification dispatcher) react. Keeping the
 * payload shapes in one file is what stops the two sides from drifting — a
 * consumer reading `payload.projectName` when the producer stopped sending it
 * fails silently at runtime otherwise.
 *
 * Names are dotted and past-tense: an event states what happened, it does not
 * instruct anyone to do anything. A producer must never assume a consumer
 * exists, and must never depend on the result of emitting.
 */

export const DomainEvent = {
  ScanQueued: 'scan.queued',
  ScanStarted: 'scan.started',
  ScanCheckFinished: 'scan.check.finished',
  ScanCompleted: 'scan.completed',
  ScanFailed: 'scan.failed',
  ScanCancelled: 'scan.cancelled',
  ProjectChanged: 'project.changed',
  ReportGenerated: 'report.generated',
  ReportFailed: 'report.failed',
  EmailSent: 'email.sent',
  EmailFailed: 'email.failed',
  SecurityWarning: 'security.warning',
  SystemError: 'system.error',
  HttpError: 'http.error',
  SettingsChanged: 'settings.changed',
  ScheduleChanged: 'schedule.changed',
  ScheduleRunStarted: 'schedule.run.started',
  ScheduleRunSkipped: 'schedule.run.skipped',
  ScheduleRunFailed: 'schedule.run.failed',
} as const;

/**
 * Who caused a scan to exist.
 *
 * Carried on every scan event so consumers can tell an operator's action from
 * the scheduler's. The audit writer uses it to attribute automatic runs to the
 * scheduler rather than to the project's owner, which is the difference between
 * an audit trail and a fiction.
 */
export type ScanTrigger = 'MANUAL' | 'SCHEDULED';

/** The provenance fields every scan event carries when a schedule caused it. */
interface ScheduledOrigin {
  trigger?: ScanTrigger;
  scheduleId?: string;
  scheduleName?: string;
}

interface BaseEvent {
  /** Correlation id shared with every other event from the same request or job. */
  requestId?: string;
  /** Who the event is attributable to, when there is a person behind it. */
  userId?: string;
}

/**
 * The lifecycle events of one scan.
 *
 * `scan.completed` and `scan.failed` were the only two that existed, which is
 * why an operator watching the live tail saw a scan's outcome but nothing of
 * its execution: no start, no per-check result, no cancellation. These fill the
 * gap so the stream describes what the application is doing rather than only
 * what it finished doing.
 */
export interface ScanQueuedEvent extends BaseEvent, ScheduledOrigin {
  assessmentId: string;
  projectId: string;
  projectName: string;
  /** How many endpoints the frozen specification carries into this run. */
  endpointCount: number;
  /** Checks resolved for this run, after profile/manual/all resolution. */
  pluginCount: number;
  executionMode: string;
}

export interface ScanStartedEvent extends BaseEvent, ScheduledOrigin {
  assessmentId: string;
  projectId: string;
  projectName?: string;
  endpointCount: number;
  pluginCount: number;
}

/**
 * One security check finished.
 *
 * Emitted per plugin rather than per request: a check is the unit an operator
 * reasons about ("did the BOLA check run?"), while per-request events would put
 * thousands of rows in the table for a single scan.
 */
export interface ScanCheckFinishedEvent extends BaseEvent, ScheduledOrigin {
  assessmentId: string;
  projectId: string;
  pluginId: string;
  pluginName: string;
  /** SUCCESS, TIMEOUT, ERROR — as reported by the plugin executor. */
  status: string;
  findingsCount: number;
  durationMs: number;
}

export interface ScanCancelledEvent extends BaseEvent {
  assessmentId: string;
  projectId: string;
  projectName: string;
  /** Where the run had reached when it was stopped. */
  progress: number;
  currentStep?: string | null;
}

/** A project was created, updated, deleted, or had a specification imported. */
export interface ProjectChangedEvent extends BaseEvent {
  projectId: string;
  projectName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  /** Dotted suffix, e.g. `created`, `spec.imported`. */
  change: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * An HTTP request produced an error response.
 *
 * Emitted by the global exception filter. Deliberately not every 4xx — see
 * `shouldRecordHttpError` in the filter for the noise policy, and why 401 and
 * 404 are excluded from it.
 */
export interface HttpErrorEvent extends BaseEvent {
  method: string;
  route: string;
  statusCode: number;
  message: string;
  /** Identical failures folded into this one by the filter's throttle. */
  repeatedCount?: number;
  errorCode?: string;
  stackTrace?: string;
  ipAddress?: string;
  durationMs?: number;
}

export interface ScanCompletedEvent extends BaseEvent, ScheduledOrigin {
  assessmentId: string;
  projectId: string;
  projectName: string;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  /**
   * The remaining severities, so a consumer can summarise a scan without going
   * back to the database.
   *
   * `criticalCount` and `highCount` above predate these and are kept rather
   * than folded in: too much already reads them, and renaming them would be a
   * larger change than this needs. Together the five are the full breakdown the
   * grouped-findings notification and the scan-completed email both render.
   */
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  securityScore: number | null;
  durationMs?: number;
}

export interface ScanFailedEvent extends BaseEvent, ScheduledOrigin {
  assessmentId: string;
  projectId: string;
  projectName: string;
  reason: string;
  errorCode?: string;
  stackTrace?: string;
  durationMs?: number;
}

// ── Scheduled scans ──────────────────────────────────────────────────────────

/**
 * A schedule was created, edited, paused, resumed, deleted, or run by hand.
 *
 * Modelled on ProjectChangedEvent rather than one event type per verb: the
 * consumers do the same thing with all of them, and a new verb should not
 * require a new listener method in two modules.
 */
export interface ScheduleChangedEvent extends BaseEvent {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName: string;
  /** Dotted suffix: `created`, `updated`, `paused`, `resumed`, `deleted`, `run_now`. */
  change: 'created' | 'updated' | 'paused' | 'resumed' | 'deleted' | 'run_now';
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * The scheduler started an assessment for a schedule.
 *
 * Separate from `scan.queued`, which the assessment pipeline emits for every
 * run whatever its origin. This one is about the SCHEDULE — it is what makes
 * "Weekly Production Scan started an assessment for Payment API" appear in the
 * live event stream, and it carries the occurrence that was honoured.
 */
export interface ScheduleRunStartedEvent extends BaseEvent {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName: string;
  assessmentId: string;
  executionId: string;
  /** The planned occurrence, which may be earlier than now after an outage. */
  scheduledFor: Date;
  trigger: ScanTrigger;
}

/**
 * An occurrence came due and was deliberately not run.
 *
 * Recorded as an event, not swallowed: "my hourly scan produced 18 scans
 * yesterday and 4 today" is only answerable if the skips are visible.
 */
export interface ScheduleRunSkippedEvent extends BaseEvent {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName: string;
  executionId: string;
  scheduledFor: Date;
  reason: string;
}

/**
 * The scheduler could not start the assessment at all.
 *
 * Distinct from `scan.failed`, which means a scan ran and failed. This means no
 * scan exists — the project lost its specification, every check was disabled,
 * the queue was unreachable. The schedule stays ACTIVE either way.
 */
export interface ScheduleRunFailedEvent extends BaseEvent {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName: string;
  executionId: string;
  scheduledFor: Date;
  reason: string;
  consecutiveFailures: number;
}

export interface ReportGeneratedEvent extends BaseEvent {
  reportId: string;
  assessmentId: string;
  projectId?: string;
  projectName?: string;
  reportType: string;
  format: string;
  /**
   * Why the report exists. `AUTOMATIC_SCAN_REPORT` is the one the email
   * pipeline reacts to — a manual CSV export should not mail anybody.
   */
  kind?: string;
  /**
   * Emitted only once bytes are on disk, so a consumer may announce the report
   * as ready without checking. This is what stops "your report is ready" from
   * being sent for a row that merely exists — see the ordering note on
   * ReportsProcessor.
   */
  securityScore?: number | null;
}

/**
 * A report could not be produced, after every retry was exhausted.
 *
 * Distinct from a single failed attempt, which is not an event at all: the
 * queue retries it and it usually succeeds. This one means the artifact is not
 * coming, and it is what turns a silently missing PDF into something the user
 * is told about.
 */
export interface ReportFailedEvent extends BaseEvent {
  reportId: string;
  assessmentId: string;
  projectId?: string;
  projectName?: string;
  reportType: string;
  format: string;
  kind?: string;
  reason: string;
  attempts: number;
}

/** An outbound message was accepted by the provider. */
export interface EmailSentEvent extends BaseEvent {
  deliveryId: string;
  template: string;
  /** Present so a notification can name the subject; never the recipient's body. */
  entityType?: string;
  entityId?: string;
  providerMessageId?: string;
  projectName?: string;
}

/**
 * An outbound message could not be delivered.
 *
 * Never fails the work that produced it: a scan whose report emailed badly is
 * still a completed scan with a downloadable report. The consumer raises an
 * in-app notification so the user learns their mail is misconfigured.
 */
export interface EmailFailedEvent extends BaseEvent {
  deliveryId?: string;
  template: string;
  entityType?: string;
  entityId?: string;
  /** Provider message or a summary. Never contains the API key. */
  reason: string;
  projectName?: string;
}

export interface SecurityWarningEvent extends BaseEvent {
  /** Overrides the default event name, e.g. `auth.login.failed`. */
  event?: string;
  message: string;
  severity?: LogSeverity;
  resource?: string;
  resourceId?: string;
  ipAddress?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  /** Whether this is worth telling an administrator about in-app. */
  notify?: boolean;
}

export interface SystemErrorEvent extends BaseEvent {
  event?: string;
  message: string;
  category?: LogCategory;
  resource?: string;
  source?: string;
  errorCode?: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  notify?: boolean;
}

export interface SettingsChangedEvent {
  changes: { key: string; from: unknown; to: unknown }[];
  actorId?: string;
}
