import { escapeHtml } from '@/lib/email/escape';
import { FONT_STACK, type ThemeTokens } from '@/lib/email/theme';
import { safeUrl } from '@/lib/validation/url';

/**
 * The pieces every template is assembled from.
 *
 * ── The rules these are all written to ──────────────────────────────────────
 *
 * This is not a web page and cannot be built like one. Every function here
 * obeys the same constraints, and each of them exists because a real client
 * breaks without it:
 *
 *  • **Tables for layout, never divs.** Outlook 2007–2021 renders through
 *    Word's HTML engine, which has no support for `float`, `flex` or `grid`.
 *    A `<div>`-based two-column layout becomes two stacked full-width blocks.
 *  • **Inline styles only.** Gmail strips `<head>` and every `<style>` block,
 *    so a class name resolves to nothing. There is no cascade to rely on.
 *  • **`role="presentation"` on every layout table**, so a screen reader
 *    announces the content rather than "table, 4 columns".
 *  • **No `background-image`, no web fonts, no `<script>`, no forms.** All are
 *    stripped or blocked, and two of them get a message flagged as spam.
 *  • **Explicit `border="0" cellpadding="0" cellspacing="0"`** as attributes,
 *    not CSS: Outlook honours the attributes and ignores the CSS equivalents.
 *
 * Every function takes typed values and escapes its own interpolations. None
 * accepts markup — that is the property that keeps a caller from getting HTML
 * into a message sent from a verified security domain, and it holds because
 * there is no parameter through which markup could arrive.
 */

/** Outer width of the message container. Fits a phone without scaling. */
const CONTAINER_WIDTH = 600;

/** Horizontal padding on every block, so the left edge is a straight line. */
const GUTTER = 32;

export interface HeaderInput {
  readonly theme: ThemeTokens;
  /** Absolute origin the logo is served from, no trailing slash. */
  readonly assetBaseUrl: string;
}

/**
 * Logo and wordmark.
 *
 * The image carries `alt="API Analyzer"` and an explicit `width`/`height`
 * because images are blocked by default in Outlook and in Gmail for a sender
 * the recipient has not corresponded with. With them, a blocked logo leaves a
 * 40px gap with the product name in it; without them, it collapses the header
 * and reflows the message.
 *
 * The wordmark sits beside the image as live text rather than being part of it,
 * for the same reason: with images off, the email still says who sent it.
 */
export function header({ theme, assetBaseUrl }: HeaderInput): string {
  const logo = `${assetBaseUrl}/brand/${theme.logoFile}`;

  return `
            <tr>
              <td style="padding:28px ${GUTTER}px 24px ${GUTTER}px;border-bottom:1px solid ${theme.hairline};">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;line-height:0;">
                      <img src="${escapeHtml(logo)}" width="32" height="32" alt="API Analyzer" style="display:block;width:32px;height:32px;border:0;outline:none;text-decoration:none;" />
                    </td>
                    <td style="vertical-align:middle;font-family:${FONT_STACK};">
                      <span style="font-size:17px;font-weight:700;color:${theme.ink};letter-spacing:-0.01em;white-space:nowrap;">API Analyzer</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/**
 * The message footer.
 *
 * Product name and one line saying what the product is, exactly as specified.
 * Deliberately no social links, no postal address and no unsubscribe link:
 * inventing URLs that do not exist would produce dead links in every email, and
 * these are transactional messages a recipient turns off in the application's
 * own notification preferences rather than through a list unsubscribe.
 */
export function footer(theme: ThemeTokens, reason: string): string {
  return `
            <tr>
              <td style="padding:22px ${GUTTER}px 26px ${GUTTER}px;border-top:1px solid ${theme.hairline};font-family:${FONT_STACK};">
                <p style="margin:0;font-size:13px;line-height:1.5;font-weight:600;color:${theme.ink};">API Analyzer</p>
                <p style="margin:3px 0 0 0;font-size:12px;line-height:1.5;color:${theme.muted};">Automated API Security Assessment</p>
                <p style="margin:12px 0 0 0;font-size:11px;line-height:1.5;color:${theme.muted};">${escapeHtml(reason)}</p>
              </td>
            </tr>`;
}

/** The page title, directly under the header. */
export function title(theme: ThemeTokens, text: string): string {
  return `
            <tr>
              <td style="padding:32px ${GUTTER}px 0 ${GUTTER}px;font-family:${FONT_STACK};">
                <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:${theme.ink};letter-spacing:-0.02em;">${escapeHtml(text)}</h1>
              </td>
            </tr>`;
}

/** `Hi {name},` — or a neutral greeting when the recipient has no name on file. */
export function greeting(theme: ThemeTokens, name: string | undefined): string {
  const trimmed = name?.trim();
  const text = trimmed ? `Hi ${trimmed},` : 'Hi,';

  return `
            <tr>
              <td style="padding:20px ${GUTTER}px 0 ${GUTTER}px;font-family:${FONT_STACK};">
                <p style="margin:0;font-size:15px;line-height:1.6;color:${theme.body};">${escapeHtml(text)}</p>
              </td>
            </tr>`;
}

/**
 * A prose paragraph.
 *
 * Takes an already-escaped HTML fragment rather than plain text, because the
 * templates need a bold project name inside a sentence. Every caller builds its
 * fragment from `escapeHtml` output — see the templates, where the escaping
 * happens at the point the untrusted value enters.
 */
export function paragraph(theme: ThemeTokens, html: string, topPadding = 12): string {
  return `
            <tr>
              <td style="padding:${topPadding}px ${GUTTER}px 0 ${GUTTER}px;font-family:${FONT_STACK};">
                <p style="margin:0;font-size:15px;line-height:1.65;color:${theme.body};">${html}</p>
              </td>
            </tr>`;
}

export interface DetailRow {
  readonly label: string;
  readonly value: string;
  /** Overrides the value colour — used for the risk level. */
  readonly valueColour?: string;
}

/**
 * The summary card: a label on the left, a value hard right, one pair per row.
 *
 * `width="100%"` plus `align="right"` on the value cell rather than a CSS
 * `justify-content`, and the label column left to size itself — Word's engine
 * ignores `text-align` on a `<td>` about as often as it honours it, but it has
 * always respected the `align` attribute.
 */
export function detailCard(theme: ThemeTokens, rows: readonly DetailRow[]): string {
  if (rows.length === 0) return '';

  const cells = rows
    .map(({ label, value, valueColour }, index) => {
      const spacing = index === 0 ? '0' : '10px';
      return `
                        <tr>
                          <td style="padding:${spacing} 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${theme.muted};">${escapeHtml(label)}</td>
                          <td align="right" style="padding:${spacing} 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;font-weight:600;color:${valueColour ?? theme.ink};">${escapeHtml(value)}</td>
                        </tr>`;
    })
    .join('');

  return `
            <tr>
              <td style="padding:24px ${GUTTER}px 0 ${GUTTER}px;">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${theme.card};border:1px solid ${theme.hairline};border-radius:10px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">${cells}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

export interface SeverityRow {
  readonly label: string;
  readonly colour: string;
  readonly count: number;
}

/**
 * The findings-by-severity breakdown.
 *
 * Kept even though the reference layout does not show one, because the field
 * that feeds it is already part of the published payload and an accepted field
 * that renders nowhere is worse than no field at all — the caller gets a 200
 * and an email missing the data they sent.
 *
 * A table of five numbers rather than a chart: a remote image is blocked by
 * default in most clients, and an inline one would add a base64 blob to every
 * message for information that reads perfectly well as text.
 */
export function severityBreakdown(theme: ThemeTokens, rows: readonly SeverityRow[]): string {
  if (rows.length === 0) return '';

  const cells = rows
    .map(
      ({ label, colour, count }, index) => `
                        <tr>
                          <td style="padding:${index === 0 ? '0' : '8px'} 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:600;color:${colour};">${escapeHtml(label)}</td>
                          <td align="right" style="padding:${index === 0 ? '0' : '8px'} 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:600;color:${theme.ink};">${Math.max(Math.trunc(count), 0)}</td>
                        </tr>`,
    )
    .join('');

  return `
            <tr>
              <td style="padding:20px ${GUTTER}px 0 ${GUTTER}px;">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.hairline};border-radius:10px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 12px 0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${theme.muted};">Findings by severity</p>
                      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">${cells}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/**
 * A tinted block for text this service did not write — a failure reason.
 *
 * Rendered as a labelled panel rather than as prose so a stack trace cannot be
 * mistaken for a sentence addressed to the reader.
 */
export function noticePanel(theme: ThemeTokens, label: string, body: string): string {
  return `
            <tr>
              <td style="padding:24px ${GUTTER}px 0 ${GUTTER}px;">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${theme.dangerSurface};border:1px solid ${theme.dangerHairline};border-radius:10px;">
                  <tr>
                    <td style="padding:16px 20px;font-family:${FONT_STACK};">
                      <p style="margin:0 0 6px 0;font-size:11px;line-height:1.4;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${theme.negative};">${escapeHtml(label)}</p>
                      <p style="margin:0;font-size:13px;line-height:1.55;color:${theme.body};word-break:break-word;">${escapeHtml(body)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

export interface Metric {
  readonly label: string;
  readonly value: string;
  /**
   * The comparison line under the figure.
   *
   * `null` means there is nothing to compare against — a previous week with no
   * activity — and renders as a neutral dash rather than a percentage. That is
   * what keeps `Infinity%` and `NaN%` out of an inbox.
   *
   * `tone` is whether the change is GOOD, not whether it went up. The two come
   * apart for half the tiles on this email: more assessments is progress and
   * reads green, while more findings — the same arithmetic sign — is a
   * regression and reads red. Colouring by direction would tell a reader their
   * security got better in the week their critical count doubled.
   */
  readonly change: {
    readonly text: string;
    readonly tone: 'positive' | 'negative' | 'neutral';
  } | null;
  /** Shown instead of a change line. Used for the "active" projects tile. */
  readonly caption?: string;
}

/**
 * The weekly metric tiles, two per row.
 *
 * Fixed at two columns in every client rather than stacking on small screens.
 * A media query would be the web answer and is worthless here — Gmail strips
 * them — so the choice is between two columns everywhere and one column
 * everywhere. Two 50% cells inside a 600px container leave ~250px per tile on
 * a desktop and ~140px on a 320px phone, which comfortably fits a two-digit
 * figure and its label.
 *
 * A trailing odd tile gets an empty cell so the last row keeps the same
 * geometry as the ones above it.
 */
export function metricGrid(theme: ThemeTokens, metrics: readonly Metric[]): string {
  if (metrics.length === 0) return '';

  const rows: string[] = [];

  for (let index = 0; index < metrics.length; index += 2) {
    const pair = [metrics[index], metrics[index + 1]];
    const cells = pair
      .map((metric, column) => {
        const padding = column === 0 ? 'padding:0 6px 0 0;' : 'padding:0 0 0 6px;';
        if (!metric) return `<td width="50%" style="${padding}"></td>`;
        return `<td width="50%" valign="top" style="${padding}">${metricTile(theme, metric)}</td>`;
      })
      .join('');

    const spacing = index === 0 ? '0' : '12px';
    rows.push(`
                    <tr>
                      <td style="padding:${spacing} 0 0 0;">
                        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                          <tr>${cells}
                          </tr>
                        </table>
                      </td>
                    </tr>`);
  }

  return `
            <tr>
              <td style="padding:24px ${GUTTER}px 0 ${GUTTER}px;">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">${rows.join('')}
                </table>
              </td>
            </tr>`;
}

/** One tile: label, figure, and either a delta or a caption. */
function metricTile(theme: ThemeTokens, metric: Metric): string {
  let trailing: string;

  if (metric.change) {
    const colour =
      metric.change.tone === 'positive'
        ? theme.positive
        : metric.change.tone === 'negative'
          ? theme.negative
          : theme.muted;

    trailing = `
                            <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:600;color:${colour};">${escapeHtml(metric.change.text)}</p>
                            <p style="margin:2px 0 0 0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;color:${theme.muted};">vs last week</p>`;
  } else if (metric.caption) {
    trailing = `
                            <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:600;color:${theme.muted};">${escapeHtml(metric.caption)}</p>
                            <p style="margin:2px 0 0 0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;color:${theme.muted};">&nbsp;</p>`;
  } else {
    // Keeps the two tiles in a row the same height when one has no trailing
    // line: an empty paragraph still occupies its line box, a missing one does
    // not, and the difference is a visibly lopsided grid.
    trailing = `
                            <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;">&nbsp;</p>
                            <p style="margin:2px 0 0 0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;">&nbsp;</p>`;
  }

  return `
                        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${theme.card};border:1px solid ${theme.hairline};border-radius:10px;">
                          <tr>
                            <td style="padding:16px 18px;">
                              <p style="margin:0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(metric.label)}</p>
                              <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:30px;line-height:1.1;font-weight:700;color:${theme.ink};letter-spacing:-0.02em;">${escapeHtml(metric.value)}</p>${trailing}
                            </td>
                          </tr>
                        </table>`;
}

/**
 * The primary call to action.
 *
 * A `<table>` with `bgcolor` wrapping an `<a>`, not a styled `<a>` alone.
 * Outlook ignores `padding` on an inline element, so a bare padded anchor
 * renders there as bare blue text; the surrounding cell is what actually paints
 * the button. `mso-padding-alt` restores the internal spacing for that engine,
 * and `mso-hide` is not needed because nothing here is conditional.
 *
 * Returns nothing at all when the URL is missing or is not http(s). The
 * templates are written so the button is optional — a self-hosted install with
 * no public address has no link worth printing, and a button going nowhere is
 * worse than no button.
 */
export function button(theme: ThemeTokens, url: string | undefined, label: string): string {
  const safe = safeUrl(url);
  if (!safe) return '';

  const href = escapeHtml(safe);

  return `
            <tr>
              <td style="padding:28px ${GUTTER}px 0 ${GUTTER}px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="${theme.accent}" style="border-radius:8px;mso-padding-alt:13px 24px;">
                      <a href="${href}" style="display:inline-block;padding:13px 24px;font-family:${FONT_STACK};font-size:14px;font-weight:600;line-height:1;color:${theme.onAccent};text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/**
 * The destination, printed under the button in small type.
 *
 * Not decoration, and not redundant with the button. This relay sends from a
 * verified security domain and the URL is supplied by whoever holds a relay
 * token, so a recipient must be able to read where a button goes before
 * pressing it — which on a phone is impossible to do by hovering.
 */
export function linkHint(theme: ThemeTokens, url: string | undefined): string {
  const safe = safeUrl(url);
  if (!safe) return '';

  return `
            <tr>
              <td style="padding:12px ${GUTTER}px 0 ${GUTTER}px;font-family:${FONT_STACK};">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${theme.muted};word-break:break-all;">${escapeHtml(safe)}</p>
              </td>
            </tr>`;
}

/** Bottom padding, so the last block does not sit against the footer rule. */
export function spacer(height = 32): string {
  return `
            <tr>
              <td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td>
            </tr>`;
}

export interface ShellInput {
  readonly theme: ThemeTokens;
  readonly subject: string;
  /**
   * The grey line clients show beside the subject in a list view. Without one,
   * they fall back to scraping the first text in the body — which here is the
   * word "API Analyzer" from the header, in every message.
   */
  readonly preheader: string;
  readonly blocks: readonly string[];
}

/**
 * The document every template is rendered into.
 *
 * `color-scheme` appears three times — a `<meta>`, a `:root` rule and a body
 * attribute — because the clients that honour it each read a different one, and
 * the ones that read none are unaffected by all three. Its job is to stop Apple
 * Mail and Outlook.com from applying their own colour inversion on top of a
 * palette this file has already resolved.
 *
 * The `<style>` block is a progressive enhancement and nothing depends on it:
 * Gmail deletes it outright, which is precisely why every colour is also
 * present inline.
 */
export function shell(input: ShellInput): string {
  const { theme } = input;

  return `<!doctype html>
<html lang="en" style="color-scheme:${theme.colorScheme};supported-color-schemes:${theme.colorScheme};">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="color-scheme" content="${theme.colorScheme}" />
    <meta name="supported-color-schemes" content="${theme.colorScheme}" />
    <title>${escapeHtml(input.subject)}</title>
    <style>
      :root { color-scheme: ${theme.colorScheme}; supported-color-schemes: ${theme.colorScheme}; }
      body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
      table { border-collapse: collapse; }
      img { -ms-interpolation-mode: bicubic; }
      a { color: ${theme.accent}; }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:${theme.canvas};color-scheme:${theme.colorScheme};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${theme.canvas};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="${CONTAINER_WIDTH}" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:${CONTAINER_WIDTH}px;background-color:${theme.surface};border:1px solid ${theme.hairline};border-radius:14px;">${input.blocks.join('')}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
