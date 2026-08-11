'use client';

import { useId, useMemo } from 'react';
import {
  Bar,
  BarChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from 'recharts';
import { IconMinus, IconShieldCheck, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { EmptyState } from '@/components/ui/empty-state';
import { brandColors } from '@/lib/brand';
import { useChartColors } from '@/lib/use-chart-colors';
import { cn } from '@/lib/utils';
import { OWASP_CATEGORIES } from './owasp-categories';
import type { ScoreTrendPoint, WeeklyFindingsPoint } from '@/types';

export { OWASP_CATEGORIES };

export function getScoreEvaluation(score: number) {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Poor';
  return 'Critical';
}

// =============================================================================
// SHARED — trend comparison badge
// =============================================================================

function formatPercent(value: number) {
  return value === 0 ? '0%' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/**
 * Period-over-period pill. The arrow always follows the direction of change; the
 * colour follows meaning. `invert` flips the semantics for metrics where "up is
 * bad" — more findings is a worse result, so an increase must read as negative.
 */
function TrendPill({ percent, invert = false, title = 'Compared with previous period' }: { percent: number | null; invert?: boolean; title?: string }) {
  if (percent === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" title={title}>
        <IconMinus className="h-3 w-3" aria-hidden="true" />
        No comparison
      </span>
    );
  }
  const up = percent > 0;
  const down = percent < 0;
  const Icon = up ? IconTrendingUp : down ? IconTrendingDown : IconMinus;
  const good = (up && !invert) || (down && invert);
  const bad = (up && invert) || (down && !invert);
  // Theme tokens, so a delta pill is the same green as every other "good" in
  // the product and adapts to the light theme instead of staying dark-mode ink.
  const tone = good ? 'bg-success/10 text-success' : bad ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums', tone)} title={title}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatPercent(percent)}
    </span>
  );
}

// =============================================================================
// OVERALL SECURITY SCORE — current calendar year (Jan–Dec)
// =============================================================================

const MAX_SCORE = 100;
const SCORE_BAR_GRADIENT_ID = 'security-score-bar-gradient';

type ScoreChartDatum = {
  month: string;
  label: string;
  fullLabel: string;
  averageScore: number | null;
  completedCount: number;
};

type GradientBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  radius?: number;
  opacity?: number;
};

function formatMonth(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1);
  return {
    short: date.toLocaleString('en-US', { month: 'short' }),
    long: date.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

/**
 * Bar renderer for the security-score trend: a rounded-top rectangle filled with
 * the shared vertical purple→blue gradient (`CustomGradientBar`). Recharts skips
 * null-valued months, so future/empty months render no bar at all.
 */
function CustomGradientBar({ x, y, width, height, fill, radius = 6, opacity = 1 }: GradientBarShapeProps) {
  if (x == null || y == null || width == null || height == null || height <= 0) return null;
  const r = Math.min(radius, width / 2, height);
  const path = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  return <path d={path} fill={fill ?? `url(#${SCORE_BAR_GRADIENT_ID})`} opacity={opacity} />;
}

function computeYearTrend(points: ScoreChartDatum[]): number | null {
  const scored = points.filter((point): point is ScoreChartDatum & { averageScore: number } => point.averageScore !== null);
  if (scored.length < 2) return null;
  const current = scored[scored.length - 1].averageScore;
  const previous = scored[scored.length - 2].averageScore;
  return previous !== 0 ? ((current - previous) / previous) * 100 : null;
}

export function SecurityScoreChart({ trend, yearAverage }: { trend: ScoreTrendPoint[]; yearAverage: number | null }) {
  const year = new Date().getFullYear();
  const overall = yearAverage === null ? null : Math.min(MAX_SCORE, Math.max(0, yearAverage));
  // The dashboard polls every 30s, so this component re-renders on a timer even
  // when the data is unchanged. Recharts treats a new `data` array identity as a
  // reason to re-run its entry animation, so memoising here is what stops the
  // bars replaying their 650ms grow every poll.
  const chartData: ScoreChartDatum[] = useMemo(
    () =>
      trend.map((point) => {
        const label = formatMonth(point.month);
        return {
          month: point.month,
          label: label.short,
          fullLabel: label.long,
          averageScore: point.averageScore === null ? null : Math.min(MAX_SCORE, Math.max(0, Math.round(point.averageScore))),
          completedCount: point.completedCount,
        };
      }),
    [trend],
  );
  const hasAnyData = chartData.some((point) => point.averageScore !== null);
  const yearTrend = computeYearTrend(chartData);
  const config = useMemo(() => ({ averageScore: { label: 'Average Security Score', color: brandColors.blue } }) satisfies ChartConfig, []);

  return (
    <Card className="flex h-full min-h-[420px] flex-col shadow-none">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Overall Security Score</CardTitle>
          <CardDescription>Monthly average across completed assessments this year</CardDescription>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pl-2">
          <div className="leading-none" aria-label={overall === null ? 'No overall score available' : `Overall average ${overall} out of ${MAX_SCORE}`}>
            <span className="text-2xl font-bold tabular-nums text-foreground">{overall === null ? '—' : overall}</span>
            {overall !== null && <span className="text-sm font-medium text-muted-foreground">/{MAX_SCORE}</span>}
          </div>
          {hasAnyData && <TrendPill percent={yearTrend} title="Compared with previous month" />}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
        {hasAnyData ? (
          <ChartContainer
            config={config}
            className="aspect-auto h-full min-h-[240px] w-full"
            role="img"
            aria-label={`Average security score by month for ${year}.${overall === null ? '' : ` Yearly average ${overall} out of ${MAX_SCORE}.`}`}
          >
            <BarChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="18%">
              <defs>
                <linearGradient id={SCORE_BAR_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                  {/* The core gradient, verbatim. Charts are one of the few
                      places the full Violet → Blue → Cyan ramp is licensed. */}
                  <stop offset="0%" stopColor={brandColors.violet} />
                  <stop offset="45%" stopColor={brandColors.blue} />
                  <stop offset="100%" stopColor={brandColors.cyan} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, MAX_SCORE]} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={9} interval={0} tick={{ fontSize: 10 }} />
              <ChartTooltip
                cursor={false}
                shared={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    hideIndicator
                    className="min-w-52 border-border/60 bg-popover px-3 py-2.5"
                    formatter={(_, __, item) => {
                      const datum = item.payload as ScoreChartDatum;
                      return (
                        <div className="grid gap-1.5">
                          <span className="font-medium text-foreground">{datum.fullLabel}</span>
                          <div className="flex items-center justify-between gap-6 text-muted-foreground">
                            <span>Average Security Score</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {datum.averageScore ?? '—'}
                              <span className="text-muted-foreground">/{MAX_SCORE}</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-6 text-muted-foreground">
                            <span>Completed assessments</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">{datum.completedCount}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar
                dataKey="averageScore"
                fill={`url(#${SCORE_BAR_GRADIENT_ID})`}
                shape={<CustomGradientBar />}
                activeBar={<CustomGradientBar opacity={0.82} />}
                maxBarSize={40}
                isAnimationActive
                animationDuration={650}
                animationEasing="ease-out"
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex min-h-[240px] flex-1 items-center justify-center">
            <EmptyState icon={IconShieldCheck} title="No score history" description="Complete an assessment to start tracking your security score." compact />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// FINDINGS BY SEVERITY — severity distribution (last 8 weeks)
// =============================================================================

const SEVERITY_SERIES = [
  { key: 'critical', name: 'Critical', colorVar: 'severity-critical' },
  { key: 'high', name: 'High', colorVar: 'severity-high' },
  { key: 'medium', name: 'Medium', colorVar: 'severity-medium' },
  { key: 'low', name: 'Low', colorVar: 'severity-low' },
  { key: 'info', name: 'Informational', colorVar: 'severity-info' },
] as const;

type SeverityRadialDatum = {
  key: string;
  name: string;
  value: number;
  fill: string;
};

export function FindingsSeverityChart({ trend, previousTotal }: { trend: WeeklyFindingsPoint[]; previousTotal: number }) {
  const colors = useChartColors();
  // Same data source and logic as before: the eight-week findings series. Each
  // radial segment is one severity's total across that window, and the badge keeps
  // comparing the visible period's total against the previous eight weeks.
  const chartData: SeverityRadialDatum[] = useMemo(
    () =>
      SEVERITY_SERIES.map((series) => ({
        key: series.key,
        name: series.name,
        value: trend.reduce((sum, point) => sum + point[series.key], 0),
        fill: colors[series.colorVar],
      })),
    [trend, colors],
  );
  const currentTotal = chartData.reduce((sum, item) => sum + item.value, 0);
  const hasFindings = currentTotal > 0 || previousTotal > 0;
  const findingsPercent = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;
  const config = useMemo(
    () =>
      Object.fromEntries(
        SEVERITY_SERIES.map((series) => [series.key, { label: series.name, color: colors[series.colorVar] }]),
      ) satisfies ChartConfig,
    [colors],
  );

  return (
    <Card className="flex h-full min-h-[420px] flex-col shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Findings by Severity</CardTitle>
          {hasFindings && <TrendPill percent={findingsPercent} invert title="Total findings vs the previous 8 weeks" />}
        </div>
        <CardDescription>Findings by severity over the last 8 weeks</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 sm:px-5">
        {hasFindings ? (
          <>
            <ChartContainer
              config={config}
              className="mx-auto aspect-square w-full max-h-[248px]"
              role="img"
              aria-label={`Findings by severity over the last 8 weeks. ${currentTotal.toLocaleString()} findings total.`}
            >
              <RadialBarChart data={chartData} innerRadius={30} outerRadius={100}>
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      className="min-w-36 border-border/60 bg-popover"
                      formatter={(_, __, item) => {
                        const datum = item.payload as SeverityRadialDatum;
                        const percentage = currentTotal > 0 ? Math.round((datum.value / currentTotal) * 100) : 0;
                        return (
                          <div className="grid gap-1">
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: datum.fill }} />
                              {datum.name}
                            </span>
                            <span className="text-muted-foreground">
                              <span className="font-mono font-medium tabular-nums text-foreground">{datum.value.toLocaleString()}</span> findings
                            </span>
                            {currentTotal > 0 && <span className="text-muted-foreground">{percentage}% of total</span>}
                          </div>
                        );
                      }}
                    />
                  }
                />
                <PolarGrid gridType="circle" stroke={colors.border} />
                {/*
                  Recharts hard-codes `role="img"` on every sector path without an
                  accessible name (`shape/Sector.js` applies it after the prop
                  spread, so it cannot be overridden), which axe reports as
                  `svg-img-alt`. The sectors are decorative here: the container
                  above carries the chart's accessible name, and every value is
                  repeated as text in the severity totals below. `aria-hidden`
                  survives Recharts' prop filter and reaches each sector.
                */}
                <RadialBar dataKey="value" aria-hidden="true" />
              </RadialBarChart>
            </ChartContainer>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5" aria-label="Severity totals">
              {chartData.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex min-h-[220px] flex-1 items-center justify-center">
            <EmptyState icon={IconShieldCheck} title="No findings" description="No findings were detected in the last 8 weeks." compact />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// OWASP API TOP 10 — open issues per category, radar with subtle glow
// =============================================================================

/**
 * This radar used to plot `AssessmentSummary.owaspCoverage` on a fixed 0–100
 * axis and call it "% coverage". That field is not a percentage: the scanner
 * fills it by counting findings per category. A workspace with four API6
 * findings therefore rendered at 4% of the radius — a dot in the middle of an
 * empty web, on an installation with nine completed scans and 37 issues.
 *
 * It now plots open issues per category, which is a count on purpose:
 *
 *   - The source is `GET /issues/stats`, so entries are deduplicated issues
 *     with a lifecycle, not raw detections. Ten scans of the same unfixed
 *     problem are one issue, where averaging or summing scan summaries would
 *     have understated or multiplied it.
 *   - The radius scales to the largest category rather than to 100, so the
 *     shape is legible whether the worst category holds 4 issues or 400.
 *
 * Note the shape still grows as security gets *worse* — that is inherent to
 * plotting problems, and the title says "Open issues" so it cannot be misread
 * as a measure of how much was tested. What *was* tested is the coverage matrix
 * in Settings → System, which is a different question and deliberately lives
 * somewhere else.
 */
type OwaspDatum = { id: string; label: string; fullName: string; value: number };

export function OwaspIssuesRadar({ issuesByCategory }: { issuesByCategory: Record<string, number> }) {
  const colors = useChartColors();
  const uid = useId().replace(/:/g, '');
  const fillId = `owasp-radar-fill-${uid}`;
  const glowId = `owasp-radar-glow-${uid}`;
  const accent = colors.primary;
  const data: OwaspDatum[] = useMemo(
    () =>
      OWASP_CATEGORIES.map((item) => ({
        ...item,
        value: Math.max(0, Math.round(Number(issuesByCategory[item.id] ?? 0))),
      })),
    [issuesByCategory],
  );
  const hasIssues = data.some((item) => item.value > 0);
  // The outer ring is the worst category. `|| 1` keeps the axis valid on the
  // frame where every value is still zero.
  const axisMax = useMemo(() => Math.max(...data.map((item) => item.value), 1), [data]);
  const config = useMemo(() => ({ value: { label: 'Open issues', color: accent } }) satisfies ChartConfig, [accent]);

  return (
    <Card className="flex h-full min-h-[420px] flex-col shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>OWASP API Top 10</CardTitle>
        <CardDescription>Open issues by category</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-4">
        {hasIssues ? (
          <ChartContainer config={config} className="mx-auto aspect-square h-full max-h-[340px] w-full max-w-[360px]">
            <RadarChart data={data} outerRadius="70%" margin={{ top: 18, right: 24, bottom: 18, left: 24 }} accessibilityLayer>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0.05} />
                </linearGradient>
                <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={accent} floodOpacity="0.45" />
                </filter>
              </defs>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="min-w-48 border-border/60 bg-popover"
                    labelFormatter={(_, payload) => (payload?.[0]?.payload as OwaspDatum | undefined)?.fullName ?? ''}
                    formatter={(_, __, item) => {
                      const datum = item.payload as OwaspDatum;
                      return (
                        <div className="flex w-full items-center justify-between gap-6 text-muted-foreground">
                          <span className="font-mono text-foreground">{datum.label}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {datum.value === 0
                              ? 'None open'
                              : `${datum.value} ${datum.value === 1 ? 'issue' : 'issues'}`}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <PolarGrid stroke={colors.border} />
              <PolarAngleAxis dataKey="label" tick={{ fill: colors['muted-foreground'], fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, axisMax]} tick={false} axisLine={false} />
              <Radar
                dataKey="value"
                stroke={accent}
                strokeWidth={2}
                fill={`url(#${fillId})`}
                fillOpacity={1}
                filter={`url(#${glowId})`}
                dot={{ r: 3, fill: accent, strokeWidth: 0 }}
                isAnimationActive
                animationDuration={650}
              />
            </RadarChart>
          </ChartContainer>
        ) : (
          <EmptyState icon={IconShieldCheck} title="No open issues" description="Categories fill in as scans report findings. See Settings → System for which categories are tested." compact />
        )}
      </CardContent>
    </Card>
  );
}
