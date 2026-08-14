/**
 * The HTML and text bodies for every transactional message.
 *
 * Plain template literals, no rendering library. The set is small, the markup is
 * constrained by what email clients actually support, and adding React Email or
 * MJML would introduce a build step and a dependency for four messages.
 *
 * Every template returns both an HTML and a text body. The text one is not a
 * courtesy: a message with no text alternative scores worse with spam filters,
 * and some clients show it in the preview line.
 */

/** The one severity breakdown shape every template renders. */
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Escapes text destined for HTML.
 *
 * Project names reach these templates unmodified and are user-controlled, so a
 * project called `<img onerror=…>` must not become markup in somebody's inbox.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline styles throughout: <style> blocks are stripped by Gmail and others.
const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#4f46e5',
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#0891b2',
  info: '#64748b',
  /** Improvement in a week-over-week figure. */
  positive: '#15803d',
};

/** How a risk level is spelled for a reader. */
const RISK_LABELS: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * `2026-08-13` → `August 13, 2026`.
 *
 * Parsed by splitting rather than with `new Date(value)`, which reads a bare
 * date as midnight UTC and then renders it in the server's local zone — turning
 * an evening scan in a western timezone into the following day. The date
 * arrives already resolved in the recipient's zone; this only spells it.
 */
function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name} ${Number(day)}, ${year}` : value;
}

/** `August 7 – 13, 2026`, collapsed as far as the two ends allow. */
function formatDateRange(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);

  const startMonth = MONTH_NAMES[fromMonth - 1];
  const endMonth = MONTH_NAMES[toMonth - 1];
  if (!startMonth || !endMonth) return `${from} – ${to}`;

  if (fromYear !== toYear) {
    return `${startMonth} ${fromDay}, ${fromYear} – ${endMonth} ${toDay}, ${toYear}`;
  }
  if (fromMonth !== toMonth) {
    return `${startMonth} ${fromDay} – ${endMonth} ${toDay}, ${toYear}`;
  }
  return `${startMonth} ${fromDay} – ${toDay}, ${toYear}`;
}

function layout(options: { heading: string; body: string; preheader: string }): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:${COLORS.surface};">
    <!-- Preheader: the grey line clients show after the subject. Hidden in the body. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.surface};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:0.02em;color:${COLORS.accent};text-transform:uppercase;">API Analyzer</p>
                <h1 style="margin:12px 0 0 0;font:600 22px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">${escapeHtml(options.heading)}</h1>
              </td>
            </tr>
            <tr><td style="padding:20px 32px 32px 32px;">${options.body}</td></tr>
          </table>
          <p style="margin:20px 0 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">
            You are receiving this because email notifications are enabled for your account.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * A call-to-action button, or nothing at all.
 *
 * An install that has not set `APP_URL`/`FRONTEND_URL` has no address to send
 * anyone to, and a button linking to the empty string is worse than no button:
 * it looks like the message is broken rather than like the link is simply not
 * offered. The plain-text half omits the line for the same reason.
 */
function button(href: string, label: string): string {
  if (!href) return '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
    <tr><td style="background:${COLORS.accent};border-radius:8px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

function severityTable(counts: SeverityCounts): string {
  const rows = (
    [
      ['Critical', counts.critical, COLORS.critical],
      ['High', counts.high, COLORS.high],
      ['Medium', counts.medium, COLORS.medium],
      ['Low', counts.low, COLORS.low],
      ['Info', counts.info, COLORS.info],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(
      ([label, count, color]) => `<tr>
        <td style="padding:6px 0;font:400 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;"></span>${label}
        </td>
        <td align="right" style="padding:6px 0;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">${count}</td>
      </tr>`,
    )
    .join('');

  if (!rows) {
    return `<p style="margin:16px 0 0 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">No issues were detected.</p>`;
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0 0;border-top:1px solid ${COLORS.border};">${rows}</table>`;
}

function textSeverities(counts: SeverityCounts): string {
  const lines = (
    [
      ['Critical', counts.critical],
      ['High', counts.high],
      ['Medium', counts.medium],
      ['Low', counts.low],
      ['Info', counts.info],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `  ${label}: ${count}`);

  return lines.length ? lines.join('\n') : '  No issues were detected.';
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface ScanCompletedEmailInput {
  projectName: string;
  securityScore: number | null;
  counts: SeverityCounts;
  totalFindings: number;
  reportUrl: string;
  /** True when the PDF rides along with the message rather than being linked. */
  attached: boolean;
  /** Set when the report was too large to attach, so the body can say why. */
  attachmentSkippedReason?: string;
  scheduleName?: string;

  /*
   * The fields the redesigned message added.
   *
   * All optional, because this renderer is also the fallback for a message
   * whose summary row is incomplete, and an absent value must produce an
   * omitted line rather than "undefined".
   */
  /** The recipient's display name. Absent for a configured team mailbox. */
  userName?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  endpointsEvaluated?: number;
  /** Calendar date in the recipient's zone, `YYYY-MM-DD`. */
  scanDate?: string;
}

/**
 * "Your security scan is complete."
 *
 * Sent once, after the report exists — never on `scan.completed` alone. That
 * ordering is the whole reason this template can promise a report at all.
 */
export function renderScanCompletedEmail(input: ScanCompletedEmailInput): RenderedEmail {
  const score =
    input.securityScore === null ? 'Not available' : `${input.securityScore}/100`;

  const origin = input.scheduleName
    ? `<p style="margin:0 0 16px 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">Triggered by the schedule <strong style="color:${COLORS.ink};">${escapeHtml(input.scheduleName)}</strong>.</p>`
    : '';

  const attachmentNote = input.attached
    ? `<p style="margin:20px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">Your PDF security report is attached to this email.</p>`
    : `<p style="margin:20px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">Your PDF security report is ready${input.attachmentSkippedReason ? ` (${escapeHtml(input.attachmentSkippedReason)})` : ''}. Open it from the button below.</p>`;

  const greeting = input.userName?.trim()
    ? `<p style="margin:0 0 16px 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">Hi ${escapeHtml(input.userName.trim())},</p>`
    : '';

  // Risk and date sit beside the score rather than in it: the score is a
  // number, these are the two facts that make it mean something.
  const facts = [
    input.riskLevel ? ['Risk', RISK_LABELS[input.riskLevel]] : null,
    input.scanDate ? ['Date', formatCalendarDate(input.scanDate)] : null,
  ].filter((row): row is [string, string] => row !== null);

  const factRows = facts
    .map(
      ([label, value]) => `
          <tr>
            <td style="padding:8px 0 0 0;font:400 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">${escapeHtml(label)}</td>
            <td align="right" style="padding:8px 0 0 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">${escapeHtml(value)}</td>
          </tr>`,
    )
    .join('');

  const coverage =
    typeof input.endpointsEvaluated === 'number'
      ? `<p style="margin:16px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">${input.totalFindings} finding${input.totalFindings === 1 ? '' : 's'} across ${input.endpointsEvaluated} endpoint${input.endpointsEvaluated === 1 ? '' : 's'} evaluated.</p>`
      : '';

  const body = `
    ${greeting}
    ${origin}
    <p style="margin:0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
      The security scan for <strong>${escapeHtml(input.projectName)}</strong> has finished.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;background:${COLORS.surface};border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;font:400 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.04em;">Security score</p>
          <p style="margin:4px 0 0 0;font:600 28px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">${escapeHtml(score)}</p>
          ${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0 0;">${factRows}</table>` : ''}
        </td>
      </tr>
    </table>
    ${coverage}

    <p style="margin:24px 0 0 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.04em;">
      Issues (${input.totalFindings})
    </p>
    ${severityTable(input.counts)}

    ${attachmentNote}
    ${button(input.reportUrl, 'View Report')}
  `;

  return {
    subject: `Scan complete — ${input.projectName}`,
    html: layout({
      heading: 'Your security scan is complete',
      preheader: `${input.projectName} — score ${score}, ${input.totalFindings} issue${input.totalFindings === 1 ? '' : 's'}`,
      body,
    }),
    text: [
      'API Analyzer',
      '',
      'Your security scan is complete.',
      '',
      `Project:\n  ${input.projectName}`,
      input.scheduleName ? `Schedule:\n  ${input.scheduleName}` : '',
      '',
      `Security Score:\n  ${score}`,
      '',
      `Issues (${input.totalFindings}):`,
      textSeverities(input.counts),
      '',
      input.attached
        ? 'Your PDF security report is attached to this email.'
        : `Your PDF security report is ready${input.attachmentSkippedReason ? ` (${input.attachmentSkippedReason})` : ''}.`,
      '',
      input.reportUrl ? `View the report: ${input.reportUrl}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

export interface ScanFailedEmailInput {
  projectName: string;
  reason: string;
  scanUrl: string;
  scheduleName?: string;
}

export function renderScanFailedEmail(input: ScanFailedEmailInput): RenderedEmail {
  const origin = input.scheduleName
    ? ` started by the schedule <strong>${escapeHtml(input.scheduleName)}</strong>`
    : '';

  const body = `
    <p style="margin:0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
      The security scan for <strong>${escapeHtml(input.projectName)}</strong>${origin} did not complete.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;background:${COLORS.surface};border-left:3px solid ${COLORS.critical};border-radius:6px;">
      <tr><td style="padding:14px 18px;font:400 14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:${COLORS.ink};">${escapeHtml(input.reason)}</td></tr>
    </table>
    <p style="margin:20px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">
      No report was generated for this run. Previous scans and their reports are unaffected.
    </p>
    ${button(input.scanUrl, 'View Scan')}
  `;

  return {
    subject: `Scan failed — ${input.projectName}`,
    html: layout({
      heading: 'Your security scan failed',
      preheader: `${input.projectName} — ${input.reason}`,
      body,
    }),
    text: [
      'API Analyzer',
      '',
      'Your security scan failed.',
      '',
      `Project:\n  ${input.projectName}`,
      input.scheduleName ? `Schedule:\n  ${input.scheduleName}` : '',
      '',
      `Reason:\n  ${input.reason}`,
      '',
      'No report was generated for this run.',
      '',
      input.scanUrl ? `View the scan: ${input.scanUrl}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

export interface CriticalFindingEmailInput {
  projectName: string;
  criticalCount: number;
  issuesUrl: string;
}

export function renderCriticalFindingEmail(input: CriticalFindingEmailInput): RenderedEmail {
  const plural = input.criticalCount === 1 ? '' : 's';

  const body = `
    <p style="margin:0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
      The latest scan of <strong>${escapeHtml(input.projectName)}</strong> detected
      <strong style="color:${COLORS.critical};">${input.criticalCount} critical vulnerabilit${input.criticalCount === 1 ? 'y' : 'ies'}</strong>.
    </p>
    <p style="margin:16px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">
      Critical issues are exploitable without authentication or expose sensitive data directly. They are worth reviewing before anything else in the report.
    </p>
    ${button(input.issuesUrl, `Review ${input.criticalCount} Issue${plural}`)}
  `;

  return {
    subject: `${input.criticalCount} critical issue${plural} — ${input.projectName}`,
    html: layout({
      heading: `${input.criticalCount} critical issue${plural} detected`,
      preheader: `${input.projectName} needs attention`,
      body,
    }),
    text: [
      'API Analyzer',
      '',
      `${input.criticalCount} critical issue${plural} detected.`,
      '',
      `Project:\n  ${input.projectName}`,
      '',
      input.issuesUrl ? `Review the issues: ${input.issuesUrl}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

// ── Weekly summary ───────────────────────────────────────────────────────────

/** One figure and its comparison. `null` means there was no previous week. */
export interface WeeklyMetricInput {
  count: number;
  changePercent: number | null;
}

export interface WeeklySummaryEmailInput {
  userName?: string;
  /** Monday of the reported week, `YYYY-MM-DD`. */
  dateFrom: string;
  /** Sunday, inclusive. */
  dateTo: string;
  assessments: WeeklyMetricInput;
  findings: WeeklyMetricInput;
  critical: WeeklyMetricInput;
  activeProjects: number;
  dashboardUrl: string;
}

/**
 * "Your weekly summary."
 *
 * The local counterpart of the relay's `weekly-summary` template, rendered only
 * on the direct-to-Resend path. The relay owns the canonical design — including
 * the dark variant, which this has no equivalent of, because an install holding
 * its own Resend key renders here and gets one look.
 *
 * The numbers, the period and the wording are the same in both, which is the
 * part that matters: the two must not disagree about what happened last week.
 */
export function renderWeeklySummaryEmail(input: WeeklySummaryEmailInput): RenderedEmail {
  const range = formatDateRange(input.dateFrom, input.dateTo);

  const tiles = [
    metricTile('Assessments', input.assessments, true),
    metricTile('Findings', input.findings, false),
    metricTile('Critical', input.critical, false),
    metricTile('Projects', { count: input.activeProjects, changePercent: null }, true, 'active'),
  ].join('');

  const body = `
    ${input.userName?.trim() ? `<p style="margin:0 0 16px 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">Hi ${escapeHtml(input.userName.trim())},</p>` : ''}
    <p style="margin:0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
      Here's a summary of your API security activity over the past week.
    </p>
    <p style="margin:16px 0 0 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">${escapeHtml(range)}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
      ${tiles}
    </table>

    ${button(input.dashboardUrl, 'View Dashboard')}
  `;

  return {
    subject: 'Your weekly summary — API Analyzer',
    html: layout({
      heading: 'Weekly Summary',
      preheader: `${range} — ${input.assessments.count} assessments, ${input.findings.count} findings`,
      body,
    }),
    text: [
      'API Analyzer',
      '',
      'Weekly Summary',
      '',
      input.userName?.trim() ? `Hi ${input.userName.trim()},` : 'Hi,',
      '',
      "Here's a summary of your API security activity over the past week.",
      '',
      range,
      '',
      textMetric('Assessments', input.assessments),
      textMetric('Findings', input.findings),
      textMetric('Critical', input.critical),
      `Projects     ${input.activeProjects} (active)`,
      '',
      input.dashboardUrl ? `View your dashboard: ${input.dashboardUrl}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

/**
 * One metric row.
 *
 * `higherIsBetter` decides the colour, not the sign: more assessments is
 * progress and reads green, more findings is a regression and reads red, and
 * both are `+`. Colouring by direction alone would congratulate a reader on the
 * week their critical count doubled.
 */
function metricTile(
  label: string,
  metric: WeeklyMetricInput,
  higherIsBetter: boolean,
  caption?: string,
): string {
  const change = formatPercent(metric.changePercent);
  const colour =
    change === null || metric.changePercent === 0
      ? COLORS.muted
      : metric.changePercent! > 0 === higherIsBetter
        ? COLORS.positive
        : COLORS.critical;

  const trailing = change
    ? `<span style="font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${colour};">${escapeHtml(change)}</span> <span style="font:400 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">vs last week</span>`
    : caption
      ? `<span style="font:400 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};">${escapeHtml(caption)}</span>`
      : '';

  return `
      <tr>
        <td style="padding:0 0 10px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.surface};border-radius:8px;">
            <tr>
              <td style="padding:14px 18px;">
                <p style="margin:0;font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(label)}</p>
                <p style="margin:6px 0 0 0;font:600 26px/1.1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">${metric.count.toLocaleString('en-US')}</p>
                ${trailing ? `<p style="margin:6px 0 0 0;">${trailing}</p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function textMetric(label: string, metric: WeeklyMetricInput): string {
  const change = formatPercent(metric.changePercent);
  const suffix = change ? ` (${change} vs last week)` : ' (no comparison available)';
  return `${label.padEnd(12)} ${metric.count}${suffix}`;
}

/** `+12%`, `-8%`, `0%`, or null when there is no baseline. See `percentChange`. */
function formatPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}
