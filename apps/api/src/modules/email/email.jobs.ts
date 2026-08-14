/** The queue outbound mail is processed on. */
export const EMAIL_QUEUE = 'email';

/**
 * The report for a completed scan is ready to be mailed.
 *
 * Carries ids only. The processor re-reads everything it needs, so a job that
 * sat in the queue through a restart sends the current state of the report
 * rather than a stale copy of it captured at enqueue time.
 */
export interface ScanReportReadyJob {
  type: 'scan-report-ready';
  reportId: string;
  assessmentId: string;
  /**
   * The project owner, when there is one.
   *
   * Optional because the recipients configured for the installation do not
   * depend on a user existing: a team mailbox should still receive the report
   * for a project whose owner was deactivated. It governs only whether the
   * owner's own copy is considered.
   */
  userId?: string;
}

export interface ScanFailedJob {
  type: 'scan-failed';
  assessmentId: string;
  userId?: string;
  reason: string;
  scheduleName?: string;
}

/**
 * A user's weekly activity digest is due.
 *
 * Carries the user and the week, and no numbers: the processor computes the
 * metrics itself, so a job that sat in the queue through a restart reports the
 * week as it actually was rather than a snapshot captured at enqueue time.
 *
 * `weekStart` is the Monday of the reported week as `YYYY-MM-DD` in the user's
 * own zone. It is both the thing that makes the idempotency key stable — the
 * same week always produces the same key, however many times the scheduler
 * ticks — and what stops a retry a day later from silently reporting a
 * different week.
 */
export interface WeeklySummaryJob {
  type: 'weekly-summary';
  userId: string;
  weekStart: string;
}

export type EmailJob = ScanReportReadyJob | ScanFailedJob | WeeklySummaryJob;
