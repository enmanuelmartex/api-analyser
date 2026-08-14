import {
  button,
  footer,
  greeting,
  header,
  linkHint,
  paragraph,
  shell,
  spacer,
  title,
} from '@/lib/email/components';
import { escapeHtml } from '@/lib/email/escape';
import { formatCount, plural } from '@/lib/email/format';
import { themeFor, type ThemeName } from '@/lib/email/theme';
import type { RenderedEmail } from '@/lib/email/types';

export interface CriticalFindingData {
  readonly userName?: string;
  readonly projectName: string;
  readonly criticalCount: number;
  readonly issuesUrl?: string;
}

export interface CriticalFindingInput {
  readonly data: CriticalFindingData;
  readonly theme?: ThemeName;
  readonly assetBaseUrl: string;
}

export const CRITICAL_FINDING_SUBJECT = 'Critical findings detected — API Analyzer';

/**
 * Critical vulnerabilities in the latest scan.
 *
 * The subject is fixed like every other, and deliberately does not carry the
 * count or the project name. A subject assembled from caller data is a subject
 * the caller controls, and this message is the one most worth spoofing: it
 * arrives from a verified security domain and it asks the reader to act.
 */
export function renderCriticalFinding(input: CriticalFindingInput): RenderedEmail {
  const theme = themeFor(input.theme);
  const { data } = input;

  const projectName = data.projectName.trim() || 'your project';
  const count = Math.max(Math.trunc(data.criticalCount), 0);
  const noun = plural(count, 'vulnerability', 'vulnerabilities');

  const blocks = [
    header({ theme, assetBaseUrl: input.assetBaseUrl }),
    title(theme, `${formatCount(count)} critical ${noun} found`),
    greeting(theme, data.userName),
    paragraph(
      theme,
      `The latest assessment of <strong style="color:${theme.ink};">${escapeHtml(projectName)}</strong> found ` +
        `<strong style="color:${theme.critical};">${formatCount(count)} critical ${noun}</strong>.`,
    ),
    paragraph(
      theme,
      'Critical findings are exploitable without special conditions and are worth looking at now.',
      16,
    ),
    button(theme, data.issuesUrl, 'Review the critical findings'),
    linkHint(theme, data.issuesUrl),
    spacer(),
    footer(
      theme,
      'You are receiving this because critical-finding alerts are enabled in your API Analyzer notification preferences.',
    ),
  ];

  const text = [
    'API ANALYZER',
    '',
    `${formatCount(count)} CRITICAL ${noun.toUpperCase()} FOUND`,
    '',
    data.userName?.trim() ? `Hi ${data.userName.trim()},` : 'Hi,',
    '',
    `The latest assessment of ${projectName} found ${formatCount(count)} critical ${noun}.`,
    'Critical findings are exploitable without special conditions and are',
    'worth looking at now.',
    '',
    ...(data.issuesUrl ? ['Review the critical findings:', data.issuesUrl, ''] : []),
    '--',
    'API Analyzer',
    'Automated API Security Assessment',
  ].join('\n');

  return {
    subject: CRITICAL_FINDING_SUBJECT,
    html: shell({
      theme,
      subject: CRITICAL_FINDING_SUBJECT,
      preheader: `${projectName} · ${formatCount(count)} critical ${noun}`,
      blocks,
    }),
    text,
  };
}
