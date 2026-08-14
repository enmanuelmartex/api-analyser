import { escapeHtml } from '@/lib/email/escape';

export interface ReportEmailInput {
  /** Already validated: trimmed, length-capped, no line breaks. */
  readonly scanName?: string;
  /** Already sanitised by `sanitiseFilename`. */
  readonly filename: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Colours lifted from the API Analyser mark so mail matches the product. */
const BRAND = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  accent: '#2563eb',
  hairline: '#e2e8f0',
  surface: '#ffffff',
  canvas: '#f1f5f9',
} as const;

/**
 * Builds the report email. The entire template lives here, on the server.
 *
 * This is the security property the endpoint's contract depends on: a caller
 * supplies a recipient, a scan name and a PDF, and nothing else. No HTML, no
 * subject override, no sender. A relay that renders caller-supplied markup and
 * sends it from a verified domain is a phishing service with extra steps, and
 * the way to not become one is to have no code path that could.
 *
 * Layout notes, for whoever edits this next: tables and inline styles, because
 * Outlook still ignores `<div>` layout and strips `<style>` blocks. The dark
 * scheme is deliberately absent — mail clients handle it inconsistently enough
 * that a light card that survives inversion beats one that half-inverts.
 */
export function buildReportEmail(input: ReportEmailInput): RenderedEmail {
  const scanName = input.scanName?.trim() || undefined;

  const subject = scanName ? `Security Report - ${scanName}` : 'API Security Report';

  const safeScanName = scanName ? escapeHtml(scanName) : undefined;
  const safeFilename = escapeHtml(input.filename);

  const scanRow = safeScanName
    ? `
              <tr>
                <td style="padding:0 0 8px 0;color:${BRAND.muted};font-size:13px;">Scan</td>
                <td style="padding:0 0 8px 0;color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right;">${safeScanName}</td>
              </tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.canvas};">
    <!-- Preheader: the grey line clients show next to the subject. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Your API security report is attached as ${safeFilename}.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${BRAND.surface};border:1px solid ${BRAND.hairline};border-radius:12px;">
            <tr>
              <td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BRAND.hairline};">
                <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.01em;">
                  API<span style="color:${BRAND.accent};">&nbsp;Analyzer</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;font-weight:700;color:${BRAND.ink};">
                  Your security report is ready
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.body};">
                  The security scan${safeScanName ? ` of <strong style="color:${BRAND.ink};">${safeScanName}</strong>` : ''} has finished and the report was generated successfully. It is attached to this email as a PDF.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${scanRow}
                        <tr>
                          <td style="color:${BRAND.muted};font-size:13px;">Attachment</td>
                          <td style="color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right;">${safeFilename}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  The report contains findings from your own scan and may describe exploitable weaknesses. Treat it as confidential.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid ${BRAND.hairline};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">
                  Sent by API Analyzer because a report was generated in your installation. This mailbox is not monitored.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    'API Analyzer',
    '',
    'Your security report is ready.',
    '',
    scanName
      ? `The security scan of "${scanName}" has finished and the report was generated successfully.`
      : 'The security scan has finished and the report was generated successfully.',
    '',
    `The report is attached to this email as ${input.filename}.`,
    '',
    'The report contains findings from your own scan and may describe',
    'exploitable weaknesses. Treat it as confidential.',
    '',
    '--',
    'Sent by API Analyzer because a report was generated in your installation.',
    'This mailbox is not monitored.',
  ].join('\n');

  return { subject, html, text };
}
