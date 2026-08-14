import { escapeHtml } from '@/lib/email/escape';
import { safeUrl } from '@/lib/validation/url';

// Re-exported because the renderers below are its main caller; the rule itself
// lives with the other validation.
export { safeUrl };

/** Colours lifted from the API Analyser mark so mail matches the product. */
export const BRAND = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  accent: '#2563eb',
  hairline: '#e2e8f0',
  surface: '#ffffff',
  canvas: '#f1f5f9',
  critical: '#b91c1c',
  criticalSurface: '#fef2f2',
  criticalHairline: '#fecaca',
} as const;

export const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * A call-to-action button with the destination printed underneath it.
 *
 * The second line is not decoration. The relay sends from a verified security
 * domain, and the URL comes from whoever holds a relay token, so a recipient
 * must be able to see where a button goes without hovering it — which is
 * something a phone cannot do at all.
 */
export function linkBlock(url: string | undefined, label: string): string {
  const safe = safeUrl(url);
  if (!safe) return '';

  const escaped = escapeHtml(safe);

  return `
            <tr>
              <td style="padding:8px 32px 24px 32px;font-family:${FONT_STACK};">
                <a href="${escaped}" style="display:inline-block;padding:11px 20px;background-color:${BRAND.accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
                <p style="margin:10px 0 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted};word-break:break-all;">${escaped}</p>
              </td>
            </tr>`;
}

/** Plain-text equivalent of {@link linkBlock}. */
export function linkText(url: string | undefined, label: string): string[] {
  const safe = safeUrl(url);
  return safe ? [`${label}: ${safe}`, ''] : [];
}

export interface LayoutInput {
  readonly subject: string;
  readonly heading: string;
  /** Already-escaped HTML fragments, in order, between heading and footer. */
  readonly blocks: readonly string[];
  /** Small print above the footer rule. Optional. */
  readonly note?: string;
}

/**
 * The shared shell every relay email is rendered into.
 *
 * Tables and inline styles, because Outlook still ignores `<div>` layout and
 * strips `<style>` blocks. No dark scheme: mail clients handle it inconsistently
 * enough that a light card which survives inversion beats one that half-inverts.
 *
 * Callers pass HTML fragments, so every one of them is responsible for escaping
 * its own interpolations — which is why the template functions below take typed
 * data and never a string of markup.
 */
export function layout(input: LayoutInput): string {
  const note = input.note
    ? `
            <tr>
              <td style="padding:4px 32px 28px 32px;font-family:${FONT_STACK};">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">${input.note}</p>
              </td>
            </tr>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.canvas};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${BRAND.surface};border:1px solid ${BRAND.hairline};border-radius:12px;">
            <tr>
              <td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BRAND.hairline};">
                <span style="font-family:${FONT_STACK};font-size:16px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.01em;">
                  API<span style="color:${BRAND.accent};">&nbsp;Analyzer</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;font-family:${FONT_STACK};">
                <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;color:${BRAND.ink};">${escapeHtml(input.heading)}</h1>
              </td>
            </tr>${input.blocks.join('')}${note}
            <tr>
              <td style="padding:18px 32px;border-top:1px solid ${BRAND.hairline};font-family:${FONT_STACK};">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">
                  Sent by API Analyzer because a scan ran in your installation. This mailbox is not monitored.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A paragraph block, from already-escaped HTML. */
export function paragraph(html: string): string {
  return `
            <tr>
              <td style="padding:12px 32px 4px 32px;font-family:${FONT_STACK};">
                <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.body};">${html}</p>
              </td>
            </tr>`;
}

/** A key/value panel. Values are escaped here; keys are literals from our code. */
export function factPanel(rows: readonly (readonly [string, string])[]): string {
  if (rows.length === 0) return '';

  const cells = rows
    .map(
      ([key, value]) => `
                        <tr>
                          <td style="padding:0 0 8px 0;color:${BRAND.muted};font-size:13px;">${escapeHtml(key)}</td>
                          <td style="padding:0 0 8px 0;color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right;">${escapeHtml(value)}</td>
                        </tr>`,
    )
    .join('');

  return `
            <tr>
              <td style="padding:12px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;font-family:${FONT_STACK};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}
