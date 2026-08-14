import { renderScanReport } from '@/lib/email/templates';
import type { RenderedEmail } from '@/lib/email/types';

export type { RenderedEmail } from '@/lib/email/types';

export interface ReportEmailInput {
  /** Already validated: trimmed, length-capped, no line breaks. */
  readonly scanName?: string;
  /** Already sanitised by `sanitiseFilename`. */
  readonly filename: string;
  /** From configuration, never from the caller. */
  readonly assetBaseUrl: string;
}

/**
 * The simple report email, for `POST /api/send-report`.
 *
 * A thin adapter over the `scan-report` template rather than a second
 * implementation of it: `/api/send-report` is the minimal endpoint — a
 * recipient, a name and a PDF — while `/api/send` carries the score, the risk
 * level, the severity breakdown and a link. They must not drift into two
 * different-looking emails, so there is one renderer and this supplies the
 * subset of its data.
 *
 * No theme is passed, so it renders light. That endpoint's callers are shell
 * scripts and first integrations that have no user and therefore no stored
 * preference; inventing one for them would be guessing.
 */
export function buildReportEmail(input: ReportEmailInput): RenderedEmail {
  return renderScanReport({
    data: { projectName: input.scanName?.trim() ?? '' },
    assetBaseUrl: input.assetBaseUrl,
    attachedFilename: input.filename,
  });
}
