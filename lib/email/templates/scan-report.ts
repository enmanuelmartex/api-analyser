import {
  button,
  detailCard,
  footer,
  greeting,
  header,
  linkHint,
  paragraph,
  severityBreakdown,
  shell,
  spacer,
  title,
  type DetailRow,
} from '@/lib/email/components';
import { escapeHtml } from '@/lib/email/escape';
import { formatCount, formatDate, formatScore, plural } from '@/lib/email/format';
import { riskPresentation, themeFor, type RiskLevel, type ThemeName } from '@/lib/email/theme';
import type { RenderedEmail, SeverityCounts } from '@/lib/email/types';

export interface ScanReportData {
  /** The recipient's display name. Absent for a configured team mailbox. */
  readonly userName?: string;
  readonly projectName: string;
  readonly securityScore?: number | null;
  readonly riskLevel?: RiskLevel;
  readonly counts?: SeverityCounts;
  readonly totalFindings?: number;
  readonly endpointsEvaluated?: number;
  /** Calendar date in the recipient's zone, `YYYY-MM-DD`. See `format.ts`. */
  readonly scanDate?: string;
  readonly reportUrl?: string;
}

export interface ScanReportInput {
  readonly data: ScanReportData;
  readonly theme?: ThemeName;
  readonly assetBaseUrl: string;
  /** Set by the handler once the PDF has been decoded and named. */
  readonly attachedFilename?: string;
}

/** The one subject this template ever sends under. Never caller-supplied. */
export const SCAN_REPORT_SUBJECT = 'Assessment completed — API Analyzer';

/**
 * "Assessment completed", with the report attached and a link to it.
 *
 * Every optional field degrades to an omitted row rather than to a placeholder.
 * That matters more here than it looks: this template is also reached through
 * `/api/send-report`, which knows only a recipient, a name and a PDF, and an
 * install whose scan produced no score must not receive a card reading
 * "Score: undefined / 100".
 */
export function renderScanReport(input: ScanReportInput): RenderedEmail {
  const theme = themeFor(input.theme);
  const { data } = input;

  const projectName = data.projectName.trim();
  const safeProject = escapeHtml(projectName || 'your project');

  const rows: DetailRow[] = [];
  if (projectName) rows.push({ label: 'Project', value: projectName });
  if (typeof data.securityScore === 'number') {
    rows.push({ label: 'Score', value: formatScore(data.securityScore) });
  }
  if (data.riskLevel) {
    const risk = riskPresentation(theme, data.riskLevel);
    rows.push({ label: 'Risk', value: risk.label, valueColour: risk.colour });
  }
  if (data.scanDate) rows.push({ label: 'Date', value: formatDate(data.scanDate) });

  const blocks = [
    header({ theme, assetBaseUrl: input.assetBaseUrl }),
    title(theme, 'Assessment completed'),
    greeting(theme, data.userName),
    paragraph(
      theme,
      `Your security assessment for <strong style="color:${theme.ink};">${safeProject}</strong> has completed successfully.`,
    ),
    detailCard(theme, rows),
    findingsSentence(theme, data),
    severityBreakdown(
      theme,
      data.counts
        ? [
            { label: 'Critical', colour: theme.critical, count: data.counts.critical },
            { label: 'High', colour: theme.high, count: data.counts.high },
            { label: 'Medium', colour: theme.medium, count: data.counts.medium },
            { label: 'Low', colour: theme.low, count: data.counts.low },
            { label: 'Info', colour: theme.info, count: data.counts.info },
          ]
        : [],
    ),
    attachmentNote(theme, input.attachedFilename),
    button(theme, data.reportUrl, 'View Full Report'),
    linkHint(theme, data.reportUrl),
    spacer(),
    footer(
      theme,
      'You are receiving this because a security assessment finished in your API Analyzer installation.',
    ),
  ];

  return {
    subject: SCAN_REPORT_SUBJECT,
    html: shell({
      theme,
      subject: SCAN_REPORT_SUBJECT,
      preheader: preheaderFor(projectName, data),
      blocks,
    }),
    text: renderText(input, theme.colorScheme),
  };
}

/**
 * "3 findings were detected across 12 endpoints evaluated."
 *
 * Built in four shapes rather than one with optional clauses, because the
 * grammar changes: a sentence about endpoints that does not know how many
 * endpoints there were is not the same sentence with a word missing.
 */
function findingsSentence(
  theme: ReturnType<typeof themeFor>,
  data: ScanReportData,
): string {
  const findings = data.totalFindings;
  const endpoints = data.endpointsEvaluated;

  if (typeof findings !== 'number' && typeof endpoints !== 'number') return '';

  if (typeof findings === 'number' && typeof endpoints === 'number') {
    return paragraph(
      theme,
      `<strong style="color:${theme.ink};">${formatCount(findings)}</strong> ${plural(findings, 'finding')} ` +
        `${plural(findings, 'was', 'were')} detected across ` +
        `<strong style="color:${theme.ink};">${formatCount(endpoints)}</strong> ${plural(endpoints, 'endpoint')} evaluated.`,
      20,
    );
  }

  if (typeof findings === 'number') {
    return paragraph(
      theme,
      `<strong style="color:${theme.ink};">${formatCount(findings)}</strong> ${plural(findings, 'finding')} ` +
        `${plural(findings, 'was', 'were')} detected.`,
      20,
    );
  }

  return paragraph(
    theme,
    `<strong style="color:${theme.ink};">${formatCount(endpoints as number)}</strong> ${plural(endpoints as number, 'endpoint')} ${plural(endpoints as number, 'was', 'were')} evaluated.`,
    20,
  );
}

/** Names the attached file, so a reader can tell the button from the PDF. */
function attachmentNote(theme: ReturnType<typeof themeFor>, filename: string | undefined): string {
  if (!filename) return '';
  return paragraph(
    theme,
    `The full report is attached as <strong style="color:${theme.ink};">${escapeHtml(filename)}</strong>.`,
    16,
  );
}

/** The line shown beside the subject in an inbox list. */
function preheaderFor(projectName: string, data: ScanReportData): string {
  const parts: string[] = [];
  if (projectName) parts.push(projectName);
  if (typeof data.securityScore === 'number') parts.push(`Score ${Math.round(data.securityScore)}/100`);
  if (typeof data.totalFindings === 'number') {
    parts.push(`${data.totalFindings} ${plural(data.totalFindings, 'finding')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Your security assessment has completed.';
}

/**
 * The plain-text alternative.
 *
 * Not a courtesy. A message with no text part scores materially worse with spam
 * filters, and several clients — including Apple Watch and most notification
 * previews — show it instead of the HTML.
 */
function renderText(input: ScanReportInput, _scheme: ThemeName): string {
  const { data } = input;
  const projectName = data.projectName.trim();

  const lines = [
    'API ANALYZER',
    '',
    'ASSESSMENT COMPLETED',
    '',
    data.userName?.trim() ? `Hi ${data.userName.trim()},` : 'Hi,',
    '',
    `Your security assessment for ${projectName || 'your project'} has completed successfully.`,
    '',
  ];

  if (projectName) lines.push(`Project:  ${projectName}`);
  if (typeof data.securityScore === 'number') lines.push(`Score:    ${formatScore(data.securityScore)}`);
  if (data.riskLevel) lines.push(`Risk:     ${riskPresentation(themeFor('light'), data.riskLevel).label}`);
  if (data.scanDate) lines.push(`Date:     ${formatDate(data.scanDate)}`);

  lines.push('');

  if (typeof data.totalFindings === 'number' && typeof data.endpointsEvaluated === 'number') {
    lines.push(
      `${formatCount(data.totalFindings)} ${plural(data.totalFindings, 'finding')} ` +
        `${plural(data.totalFindings, 'was', 'were')} detected across ` +
        `${formatCount(data.endpointsEvaluated)} ${plural(data.endpointsEvaluated, 'endpoint')} evaluated.`,
    );
    lines.push('');
  } else if (typeof data.totalFindings === 'number') {
    lines.push(
      `${formatCount(data.totalFindings)} ${plural(data.totalFindings, 'finding')} ${plural(data.totalFindings, 'was', 'were')} detected.`,
    );
    lines.push('');
  }

  if (data.counts) {
    lines.push(
      'Findings by severity:',
      `  Critical  ${data.counts.critical}`,
      `  High      ${data.counts.high}`,
      `  Medium    ${data.counts.medium}`,
      `  Low       ${data.counts.low}`,
      `  Info      ${data.counts.info}`,
      '',
    );
  }

  if (input.attachedFilename) {
    lines.push(`The full report is attached as ${input.attachedFilename}.`, '');
  }

  if (data.reportUrl) {
    lines.push('View the full report:', data.reportUrl, '');
  }

  lines.push(
    '--',
    'API Analyzer',
    'Automated API Security Assessment',
    '',
    'You are receiving this because a security assessment finished in your',
    'API Analyzer installation.',
  );

  return lines.join('\n');
}
