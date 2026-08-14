import {
  button,
  detailCard,
  footer,
  greeting,
  header,
  linkHint,
  noticePanel,
  paragraph,
  shell,
  spacer,
  title,
  type DetailRow,
} from '@/lib/email/components';
import { escapeHtml } from '@/lib/email/escape';
import { themeFor, type ThemeName } from '@/lib/email/theme';
import type { RenderedEmail } from '@/lib/email/types';

export interface ScanFailedData {
  readonly userName?: string;
  readonly projectName: string;
  readonly reason: string;
  readonly scanUrl?: string;
  readonly scheduleName?: string;
}

export interface ScanFailedInput {
  readonly data: ScanFailedData;
  readonly theme?: ThemeName;
  readonly assetBaseUrl: string;
}

export const SCAN_FAILED_SUBJECT = 'Assessment failed — API Analyzer';

/**
 * A scan that did not finish.
 *
 * Shares the shell, the header and the footer with the completed-scan message
 * so the two are recognisably from the same product, and differs where it
 * should: no score, no report, and the provider's own failure text in a panel
 * that reads as machine output rather than as a sentence written to the reader.
 */
export function renderScanFailed(input: ScanFailedInput): RenderedEmail {
  const theme = themeFor(input.theme);
  const { data } = input;

  const projectName = data.projectName.trim() || 'your project';
  const rows: DetailRow[] = [{ label: 'Project', value: projectName }];
  if (data.scheduleName) rows.push({ label: 'Schedule', value: data.scheduleName });

  const blocks = [
    header({ theme, assetBaseUrl: input.assetBaseUrl }),
    title(theme, 'Assessment failed'),
    greeting(theme, data.userName),
    paragraph(
      theme,
      `Your security assessment for <strong style="color:${theme.ink};">${escapeHtml(projectName)}</strong> did not complete.` +
        (data.scheduleName
          ? ' The schedule remains active and will try again at its next occurrence.'
          : ''),
    ),
    detailCard(theme, rows),
    noticePanel(theme, 'Reason', data.reason),
    paragraph(
      theme,
      'No report was generated for this run. Previous reports are unaffected.',
      20,
    ),
    button(theme, data.scanUrl, 'Open the assessment'),
    linkHint(theme, data.scanUrl),
    spacer(),
    footer(
      theme,
      'You are receiving this because a security assessment ran in your API Analyzer installation.',
    ),
  ];

  const text = [
    'API ANALYZER',
    '',
    'ASSESSMENT FAILED',
    '',
    data.userName?.trim() ? `Hi ${data.userName.trim()},` : 'Hi,',
    '',
    `Your security assessment for ${projectName} did not complete.`,
    ...(data.scheduleName
      ? [`Schedule: ${data.scheduleName} — it remains active and will try again.`]
      : []),
    '',
    `Reason: ${data.reason}`,
    '',
    'No report was generated for this run. Previous reports are unaffected.',
    '',
    ...(data.scanUrl ? ['Open the assessment:', data.scanUrl, ''] : []),
    '--',
    'API Analyzer',
    'Automated API Security Assessment',
  ].join('\n');

  return {
    subject: SCAN_FAILED_SUBJECT,
    html: shell({
      theme,
      subject: SCAN_FAILED_SUBJECT,
      preheader: `${projectName} · the assessment did not complete`,
      blocks,
    }),
    text,
  };
}
