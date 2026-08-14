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
  userId: string;
}

export interface ScanFailedJob {
  type: 'scan-failed';
  assessmentId: string;
  userId: string;
  reason: string;
  scheduleName?: string;
}

export type EmailJob = ScanReportReadyJob | ScanFailedJob;
