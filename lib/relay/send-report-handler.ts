import { buildReportEmail } from '@/lib/email/report-email';
import type { RelayDependencies } from '@/lib/relay/dependencies';
import { deliver, runRelayRequest } from '@/lib/relay/pipeline';
import { sanitiseFilename } from '@/lib/validation/filename';
import { decodePdfBase64 } from '@/lib/validation/pdf';
import { parseSendReportRequest } from '@/lib/validation/send-report.schema';

/**
 * `POST /api/send-report` — the minimal endpoint: a recipient, a name, a PDF.
 *
 * Kept alongside the richer `/api/send` because it is the one a shell script or
 * a first integration reaches for, and because it was the published contract
 * before `/api/send` existed. Both render the same `scan-report` template, so
 * the two endpoints cannot drift into two different-looking emails.
 *
 * Living here rather than in `route.ts` is what makes it testable as a plain
 * function: the tests call it with a `Request` and a set of fakes and get a
 * `Response` back, with no Next.js server and no provider in the loop.
 */
export async function handleSendReport(
  request: Request,
  injected?: RelayDependencies,
): Promise<Response> {
  return runRelayRequest(request, injected, async (body, context) => {
    const payload = parseSendReportRequest(body);
    const filename = sanitiseFilename(payload.filename);
    const pdf = decodePdfBase64(payload.pdfBase64);

    // Every part of the message comes from this server except the recipient,
    // the scan name and the bytes.
    const { subject, html, text } = buildReportEmail({
      scanName: payload.scanName,
      filename,
      assetBaseUrl: context.deps.config.assetBaseUrl,
    });

    return deliver(context, {
      to: payload.email,
      subject,
      html,
      text,
      attachments: [{ filename, content: pdf }],
      template: 'scan-report',
    });
  });
}
