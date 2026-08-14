import { escapeHtml } from '@/lib/email/escape';
import {
  BRAND,
  FONT_STACK,
  factPanel,
  layout,
  linkBlock,
  linkText,
  paragraph,
  type RenderedEmail,
} from '@/lib/email/layout';

export interface SeverityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
}

export interface ScanReportData {
  readonly projectName: string;
  readonly securityScore?: number | null;
  readonly counts?: SeverityCounts;
  readonly totalFindings?: number;
  readonly reportUrl?: string;
}

export interface ScanFailedData {
  readonly projectName: string;
  readonly reason: string;
  readonly scanUrl?: string;
  readonly scheduleName?: string;
}

export interface CriticalFindingData {
  readonly projectName: string;
  readonly criticalCount: number;
  readonly issuesUrl?: string;
}

export type TemplateInput =
  | {
      readonly template: 'scan-report';
      readonly data: ScanReportData;
      /** Set by the handler once the PDF has been decoded and named. */
      readonly attachedFilename?: string;
    }
  | { readonly template: 'scan-failed'; readonly data: ScanFailedData }
  | { readonly template: 'critical-finding'; readonly data: CriticalFindingData };

export type TemplateName = TemplateInput['template'];

export const TEMPLATE_NAMES = ['scan-report', 'scan-failed', 'critical-finding'] as const;

/**
 * Renders one of the fixed set of messages this service is willing to send.
 *
 * The set being fixed *is* the security model. A caller names a template and
 * supplies typed values; it cannot supply markup, a subject, or a sender. A
 * relay that renders caller-controlled HTML and sends it from a verified
 * security domain is a phishing service with extra steps, and the way not to
 * become one is to have no code path that could.
 */
export function renderTemplate(input: TemplateInput): RenderedEmail {
  switch (input.template) {
    case 'scan-report':
      return renderScanReport(input.data, input.attachedFilename);
    case 'scan-failed':
      return renderScanFailed(input.data);
    case 'critical-finding':
      return renderCriticalFinding(input.data);
    default: {
      // Exhaustive: a template added to the union without a branch is a
      // compile error rather than a runtime surprise.
      const unreachable: never = input;
      throw new Error(`Unknown template: ${JSON.stringify(unreachable)}`);
    }
  }
}

// ── scan-report ──────────────────────────────────────────────────────────────

export function renderScanReport(
  data: ScanReportData,
  attachedFilename?: string,
): RenderedEmail {
  const projectName = data.projectName.trim();
  const subject = projectName ? `Security Report - ${projectName}` : 'API Security Report';
  const safeProject = projectName ? escapeHtml(projectName) : undefined;

  const facts: [string, string][] = [];
  if (projectName) facts.push(['Scan', projectName]);
  if (typeof data.securityScore === 'number') {
    facts.push(['Security score', `${Math.round(data.securityScore)} / 100`]);
  }
  if (typeof data.totalFindings === 'number') {
    facts.push(['Findings', String(data.totalFindings)]);
  }
  if (attachedFilename) facts.push(['Attachment', attachedFilename]);

  const blocks = [
    paragraph(
      `The security scan${safeProject ? ` of <strong style="color:${BRAND.ink};">${safeProject}</strong>` : ''} has finished and the report was generated successfully.` +
        (attachedFilename ? ' It is attached to this email as a PDF.' : ''),
    ),
    factPanel(facts),
    severityTable(data.counts),
    linkBlock(data.reportUrl, 'View the full report'),
  ];

  const html = layout({
    subject,
    heading: 'Your security report is ready',
    blocks,
    note: 'The report contains findings from your own scan and may describe exploitable weaknesses. Treat it as confidential.',
  });

  const text = [
    'API Analyzer',
    '',
    'Your security report is ready.',
    '',
    projectName
      ? `The security scan of "${projectName}" has finished and the report was generated successfully.`
      : 'The security scan has finished and the report was generated successfully.',
    '',
    ...(typeof data.securityScore === 'number'
      ? [`Security score: ${Math.round(data.securityScore)}/100`]
      : []),
    ...(typeof data.totalFindings === 'number' ? [`Findings: ${data.totalFindings}`] : []),
    ...severityLines(data.counts),
    ...(attachedFilename ? ['', `The report is attached as ${attachedFilename}.`] : []),
    '',
    ...linkText(data.reportUrl, 'View the full report'),
    'The report contains findings from your own scan and may describe',
    'exploitable weaknesses. Treat it as confidential.',
    '',
    '--',
    'Sent by API Analyzer because a scan ran in your installation.',
    'This mailbox is not monitored.',
  ].join('\n');

  return { subject, html, text };
}

// ── scan-failed ──────────────────────────────────────────────────────────────

export function renderScanFailed(data: ScanFailedData): RenderedEmail {
  const projectName = data.projectName.trim() || 'your project';
  const subject = `Security Scan Failed - ${projectName}`;

  const facts: [string, string][] = [['Project', projectName]];
  if (data.scheduleName) facts.push(['Schedule', data.scheduleName]);

  const blocks = [
    paragraph(
      `The security scan of <strong style="color:${BRAND.ink};">${escapeHtml(projectName)}</strong> did not complete.` +
        (data.scheduleName
          ? ' The schedule remains active and will try again at its next occurrence.'
          : ''),
    ),
    factPanel(facts),
    // The reason is provider-supplied text rendered in a fixed-width block
    // rather than as prose, so a long stack trace stays readable and cannot be
    // mistaken for a message written to the recipient.
    `
            <tr>
              <td style="padding:12px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.criticalSurface};border:1px solid ${BRAND.criticalHairline};border-radius:8px;">
                  <tr>
                    <td style="padding:14px 18px;font-family:${FONT_STACK};">
                      <p style="margin:0 0 4px 0;font-size:12px;font-weight:600;color:${BRAND.critical};text-transform:uppercase;letter-spacing:0.04em;">Reason</p>
                      <p style="margin:0;font-size:13px;line-height:1.5;color:${BRAND.body};word-break:break-word;">${escapeHtml(data.reason)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`,
    linkBlock(data.scanUrl, 'Open the scan'),
  ];

  const html = layout({
    subject,
    heading: 'A security scan failed',
    blocks,
    note: 'No report was generated for this run. Previous reports are unaffected.',
  });

  const text = [
    'API Analyzer',
    '',
    'A security scan failed.',
    '',
    `The security scan of "${projectName}" did not complete.`,
    ...(data.scheduleName
      ? [`Schedule: ${data.scheduleName} — it remains active and will try again.`]
      : []),
    '',
    `Reason: ${data.reason}`,
    '',
    ...linkText(data.scanUrl, 'Open the scan'),
    'No report was generated for this run. Previous reports are unaffected.',
    '',
    '--',
    'Sent by API Analyzer because a scan ran in your installation.',
    'This mailbox is not monitored.',
  ].join('\n');

  return { subject, html, text };
}

// ── critical-finding ─────────────────────────────────────────────────────────

export function renderCriticalFinding(data: CriticalFindingData): RenderedEmail {
  const projectName = data.projectName.trim() || 'your project';
  const count = Math.max(Math.trunc(data.criticalCount), 0);
  const plural = count === 1 ? 'vulnerability' : 'vulnerabilities';
  const subject = `Critical: ${count} ${plural} in ${projectName}`;

  const blocks = [
    paragraph(
      `The latest scan of <strong style="color:${BRAND.ink};">${escapeHtml(projectName)}</strong> found ` +
        `<strong style="color:${BRAND.critical};">${count} critical ${plural}</strong>. ` +
        'Critical findings are exploitable without special conditions and are worth looking at now.',
    ),
    linkBlock(data.issuesUrl, 'Review the critical findings'),
  ];

  const html = layout({
    subject,
    heading: `${count} critical ${plural} found`,
    blocks,
    note: 'You are receiving this because critical-finding alerts are enabled for this installation.',
  });

  const text = [
    'API Analyzer',
    '',
    `${count} critical ${plural} found.`,
    '',
    `The latest scan of "${projectName}" found ${count} critical ${plural}.`,
    'Critical findings are exploitable without special conditions and are',
    'worth looking at now.',
    '',
    ...linkText(data.issuesUrl, 'Review the critical findings'),
    '--',
    'Sent by API Analyzer because a scan ran in your installation.',
    'This mailbox is not monitored.',
  ].join('\n');

  return { subject, html, text };
}

// ── shared pieces ────────────────────────────────────────────────────────────

const SEVERITY_ROWS = [
  { key: 'critical', label: 'Critical', colour: '#b91c1c' },
  { key: 'high', label: 'High', colour: '#c2410c' },
  { key: 'medium', label: 'Medium', colour: '#a16207' },
  { key: 'low', label: 'Low', colour: '#0369a1' },
  { key: 'info', label: 'Info', colour: '#475569' },
] as const;

/**
 * The severity breakdown, as a table rather than a chart.
 *
 * Deliberately not an image: a remote image is blocked by default in most
 * clients, and an inline one bloats every message. Five numbers read fine.
 */
function severityTable(counts: SeverityCounts | undefined): string {
  if (!counts) return '';

  const cells = SEVERITY_ROWS.map(
    ({ key, label, colour }) => `
                        <tr>
                          <td style="padding:0 0 6px 0;font-size:13px;color:${colour};font-weight:600;">${label}</td>
                          <td style="padding:0 0 6px 0;font-size:13px;color:${BRAND.ink};font-weight:600;text-align:right;">${Math.max(Math.trunc(counts[key]), 0)}</td>
                        </tr>`,
  ).join('');

  return `
            <tr>
              <td style="padding:4px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.hairline};border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;font-family:${FONT_STACK};">
                      <p style="margin:0 0 10px 0;font-size:12px;font-weight:600;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.04em;">Findings by severity</p>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function severityLines(counts: SeverityCounts | undefined): string[] {
  if (!counts) return [];
  return [
    '',
    'Findings by severity:',
    ...SEVERITY_ROWS.map(
      ({ key, label }) => `  ${label.padEnd(9)} ${Math.max(Math.trunc(counts[key]), 0)}`,
    ),
  ];
}
