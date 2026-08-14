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

export type EmailJob = ScanReportReadyJob | ScanFailedJob;
