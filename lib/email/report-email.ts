import { renderScanReport } from '@/lib/email/templates';
import type { RenderedEmail } from '@/lib/email/layout';

export type { RenderedEmail } from '@/lib/email/layout';

export interface ReportEmailInput {
  /** Already validated: trimmed, length-capped, no line breaks. */
  readonly scanName?: string;
  /** Already sanitised by `sanitiseFilename`. */
  readonly filename: string;
}

/**
 * The simple report email, for `POST /api/send-report`.
 *
 * A thin adapter over the `scan-report` template rather than a second
 * implementation of it: `/api/send-report` is the minimal endpoint — a
 * recipient, a name and a PDF — while `/api/send` carries the score, the
 * severity breakdown and a link. They must not drift into two different-looking
 * emails, so there is one renderer and this supplies the subset of its data.
 */
export function buildReportEmail(input: ReportEmailInput): RenderedEmail {
  return renderScanReport({ projectName: input.scanName?.trim() ?? '' }, input.filename);
}
