import {
  button,
  footer,
  greeting,
  header,
  linkHint,
  metricGrid,
  paragraph,
  shell,
  spacer,
  title,
  type Metric,
} from '@/lib/email/components';
import { FONT_STACK, themeFor, type ThemeName, type ThemeTokens } from '@/lib/email/theme';
import { escapeHtml } from '@/lib/email/escape';
import { formatCount, formatDateRange, formatPercent, toneFor } from '@/lib/email/format';
import type { RenderedEmail } from '@/lib/email/types';

/**
 * One figure and its comparison with the week before.
 *
 * `changePercent` is nullable and the null is load-bearing: it means the
 * previous week had nothing to compare against, which is a different statement
 * from "no change" and must not be rendered as `0%`. A user's first week shows
 * a dash, not a fabricated baseline.
 */
export interface WeeklyMetric {
  readonly count: number;
  readonly changePercent: number | null;
}

export interface WeeklySummaryData {
  readonly userName?: string;
  /** First day of the reported week, `YYYY-MM-DD`, in the recipient's zone. */
  readonly dateFrom: string;
  /** Last day, inclusive. */
  readonly dateTo: string;
  readonly assessments: WeeklyMetric;
  readonly findings: WeeklyMetric;
  readonly critical: WeeklyMetric;
  /** A state, not an event, so it has no week-over-week comparison. */
  readonly activeProjects: number;
  readonly dashboardUrl?: string;
}

export interface WeeklySummaryInput {
  readonly data: WeeklySummaryData;
  readonly theme?: ThemeName;
  readonly assetBaseUrl: string;
}

/** The one subject this template ever sends under. Never caller-supplied. */
export const WEEKLY_SUMMARY_SUBJECT = 'Your weekly summary — API Analyzer';

/**
 * The week in review: four figures, three of them compared with the week before.
 *
 * Assessments is the only tile where a rise is good news. Findings and criticals
 * are defect counts, so their tone is inverted — see `toneFor`. Getting that
 * backwards would send a green `+40%` to a user whose critical vulnerabilities
 * nearly doubled, which is worse than sending no email.
 */
export function renderWeeklySummary(input: WeeklySummaryInput): RenderedEmail {
  const theme = themeFor(input.theme);
  const { data } = input;

  const range = formatDateRange(data.dateFrom, data.dateTo);

  const metrics: Metric[] = [
    metricFor('Assessments', data.assessments, true),
    metricFor('Findings', data.findings, false),
    metricFor('Critical', data.critical, false),
    {
      label: 'Projects',
      value: formatCount(data.activeProjects),
      change: null,
      caption: 'active',
    },
  ];

  const blocks = [
    header({ theme, assetBaseUrl: input.assetBaseUrl }),
    title(theme, 'Weekly Summary'),
    greeting(theme, data.userName),
    paragraph(
      theme,
      "Here's a summary of your API security activity over the past week.",
    ),
    rangeBadge(theme, range),
    metricGrid(theme, metrics),
    button(theme, data.dashboardUrl, 'View Dashboard'),
    linkHint(theme, data.dashboardUrl),
    spacer(),
    footer(
      theme,
      'You are receiving this weekly summary because it is enabled in your API Analyzer notification preferences.',
    ),
  ];

  return {
    subject: WEEKLY_SUMMARY_SUBJECT,
    html: shell({
      theme,
      subject: WEEKLY_SUMMARY_SUBJECT,
      preheader: `${range} · ${formatCount(data.assessments.count)} assessments · ${formatCount(data.findings.count)} findings`,
      blocks,
    }),
    text: renderText(data, range),
  };
}

/** Builds a tile, resolving the delta and its tone together so they agree. */
function metricFor(label: string, metric: WeeklyMetric, higherIsBetter: boolean): Metric {
  const text = formatPercent(metric.changePercent);

  return {
    label,
    value: formatCount(metric.count),
    change: text ? { text, tone: toneFor(metric.changePercent, higherIsBetter) } : null,
  };
}

/**
 * The reported period, as a pill above the figures.
 *
 * Prominent on purpose. A weekly digest that does not say which week it covers
 * is ambiguous the moment one is delivered late or read out of order, and a
 * reader comparing two of them has no way to tell which is which.
 */
function rangeBadge(theme: ThemeTokens, range: string): string {
  return `
            <tr>
              <td style="padding:22px 32px 0 32px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:7px 14px;background-color:${theme.card};border:1px solid ${theme.hairline};border-radius:999px;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:600;color:${theme.body};white-space:nowrap;">${escapeHtml(range)}</td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function renderText(data: WeeklySummaryData, range: string): string {
  const line = (label: string, metric: WeeklyMetric): string => {
    const change = formatPercent(metric.changePercent);
    const suffix = change ? ` (${change} vs last week)` : ' (no comparison available)';
    return `${label.padEnd(13)} ${formatCount(metric.count)}${suffix}`;
  };

  const lines = [
    'API ANALYZER',
    '',
    'WEEKLY SUMMARY',
    '',
    data.userName?.trim() ? `Hi ${data.userName.trim()},` : 'Hi,',
    '',
    "Here's a summary of your API security activity over the past week.",
    '',
    range,
    '',
    line('Assessments', data.assessments),
    line('Findings', data.findings),
    line('Critical', data.critical),
    `${'Projects'.padEnd(13)} ${formatCount(data.activeProjects)} (active)`,
    '',
  ];

  if (data.dashboardUrl) {
    lines.push('View your dashboard:', data.dashboardUrl, '');
  }

  lines.push(
    '--',
    'API Analyzer',
    'Automated API Security Assessment',
    '',
    'You are receiving this weekly summary because it is enabled in your',
    'API Analyzer notification preferences.',
  );

  return lines.join('\n');
}
