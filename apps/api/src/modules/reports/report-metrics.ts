/**
 * Aggregation rules for the Reports screen.
 *
 * Every number here answers a question about *reports*, not about the platform
 * as a whole — the Dashboard already answers the latter, and showing the same
 * totals in both places made them look like a contradiction whenever a scan had
 * no report.
 *
 * Two rules hold throughout:
 *
 *   • **Scope is "assessments that produced at least one report."** An avg score
 *     or a finding count that silently included unreported scans would not match
 *     anything on the page below it.
 *
 *   • **Findings are counted once per assessment, never once per artifact.** One
 *     scan exported to PDF + HTML + SARIF is three report rows but one set of
 *     findings. Folding over report rows multiplied every severity by the number
 *     of formats — the "duplicated data" the Reports page showed.
 *
 * Kept pure so the counting rules are unit testable without a database.
 */

export interface ReportedAssessment {
  id: string;
  projectId: string;
  /** When the scan ran — the trend is a scan timeline, not an export timeline. */
  completedAt: Date;
  securityScore: number | null;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export interface ReportTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  /** Scans that completed on this day. 0 means "no scan ran", not "nothing found". */
  scans: number;
}

export interface TrendDelta {
  /** Findings in the most recent half of the window. */
  current: number;
  /** Findings in the preceding half. */
  previous: number;
  /** Signed percentage change. Negative means fewer vulnerabilities — an improvement. */
  changePercent: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Change in average security score between two consecutive windows.
 *
 * Reported in POINTS first: a score is already a 0–100 scale, so "+8 pts" is
 * exact and needs no baseline, whereas a percentage of a score invites the
 * reader to confuse it with the score itself. The percentage is offered
 * alongside, and is null when the previous average is 0 — there is no honest
 * percentage change from nothing.
 */
export interface ScoreDelta {
  currentAverage: number;
  previousAverage: number;
  /** Signed whole points. Positive means the posture improved. */
  deltaPoints: number;
  /** Signed percentage, or null when the previous average was 0. */
  deltaPercent: number | null;
  direction: 'up' | 'down' | 'flat';
  currentSampleSize: number;
  previousSampleSize: number;
}

export interface SeverityTotals {
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  totalFindings: number;
}

export function emptySeverityTotals(): SeverityTotals {
  return {
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    totalFindings: 0,
  };
}

/**
 * Sums severities across reported assessments.
 *
 * The input is already one entry per assessment, which is exactly what keeps a
 * multi-format scan from being counted several times.
 */
export function sumSeverities(assessments: ReportedAssessment[]): SeverityTotals {
  return assessments.reduce<SeverityTotals>((totals, a) => {
    totals.criticalCount += a.critical;
    totals.highCount += a.high;
    totals.mediumCount += a.medium;
    totals.lowCount += a.low;
    totals.infoCount += a.info;
    totals.totalFindings += a.total;
    return totals;
  }, emptySeverityTotals());
}

/**
 * Average security score across reported assessments that actually produced one.
 *
 * Scans with no score are excluded rather than substituted. Treating "no score"
 * as 100 previously made an unscannable target look perfectly secure, and
 * treating it as 0 would have looked like a catastrophic finding.
 */
export function averageScore(assessments: ReportedAssessment[]): {
  avgSecurityScore: number | null;
  scoredAssessments: number;
} {
  const scored = assessments
    .map((a) => a.securityScore)
    .filter((score): score is number => typeof score === 'number');

  return {
    avgSecurityScore:
      scored.length > 0
        ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
        : null,
    scoredAssessments: scored.length,
  };
}

/**
 * Compares the average score of the last `windowDays` against the `windowDays`
 * immediately before them.
 *
 * Returns null when either window holds no scored assessment. A first-ever scan
 * has nothing to be "up" or "down" against, and inventing a baseline of 0 would
 * render every initial report as a catastrophic +72 point improvement. The
 * caller shows "No previous period data" instead of a badge.
 *
 * Each assessment contributes once regardless of how many report formats it was
 * exported to — the input is already one entry per assessment.
 */
export function averageScoreDelta(
  assessments: ReportedAssessment[],
  windowDays: number,
  now: Date = new Date(),
): ScoreDelta | null {
  const end = now.getTime();
  const currentStart = end - windowDays * DAY_MS;
  const previousStart = currentStart - windowDays * DAY_MS;

  const inWindow = (from: number, to: number) =>
    assessments.filter((a) => {
      const at = a.completedAt.getTime();
      return at >= from && at < to && typeof a.securityScore === 'number';
    });

  const current = inWindow(currentStart, end);
  const previous = inWindow(previousStart, currentStart);

  if (current.length === 0 || previous.length === 0) return null;

  const mean = (list: ReportedAssessment[]) =>
    Math.round(list.reduce((sum, a) => sum + (a.securityScore as number), 0) / list.length);

  const currentAverage = mean(current);
  const previousAverage = mean(previous);
  const deltaPoints = currentAverage - previousAverage;

  return {
    currentAverage,
    previousAverage,
    deltaPoints,
    deltaPercent:
      previousAverage === 0
        ? null
        : Math.round((deltaPoints / previousAverage) * 1000) / 10,
    direction: deltaPoints > 0 ? 'up' : deltaPoints < 0 ? 'down' : 'flat',
    currentSampleSize: current.length,
    previousSampleSize: previous.length,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Daily findings-by-severity over a continuous window ending today.
 *
 * Days on which no scan ran are emitted as zeros with `scans: 0` rather than
 * omitted. Dropping them would compress the x-axis and draw a slope between two
 * scans a fortnight apart as if findings had trended smoothly between them; the
 * zero is the honest reading — no findings were recorded that day — and `scans`
 * lets the tooltip say why.
 */
export function buildTrend(
  assessments: ReportedAssessment[],
  windowDays: number,
  now: Date = new Date(),
): ReportTrendPoint[] {
  const points = new Map<string, ReportTrendPoint>();

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = windowDays - 1; i >= 0; i--) {
    const key = dayKey(new Date(end.getTime() - i * DAY_MS));
    points.set(key, { date: key, critical: 0, high: 0, medium: 0, low: 0, total: 0, scans: 0 });
  }

  for (const assessment of assessments) {
    const point = points.get(dayKey(assessment.completedAt));
    if (!point) continue; // outside the window
    point.critical += assessment.critical;
    point.high += assessment.high;
    point.medium += assessment.medium;
    point.low += assessment.low;
    point.total += assessment.total;
    point.scans += 1;
  }

  return [...points.values()];
}

/**
 * Compares the two halves of the trend window.
 *
 * Returns null when the earlier half holds no findings at all: "+100%" against a
 * baseline of zero is noise, not a trend, and the UI omits the badge instead of
 * inventing one.
 */
export function trendDelta(points: ReportTrendPoint[]): TrendDelta | null {
  if (points.length < 2) return null;

  const midpoint = Math.floor(points.length / 2);
  const previous = points.slice(0, midpoint).reduce((sum, p) => sum + p.total, 0);
  const current = points.slice(midpoint).reduce((sum, p) => sum + p.total, 0);

  if (previous === 0) return null;

  const changePercent = Math.round(((current - previous) / previous) * 1000) / 10;
  return {
    current,
    previous,
    changePercent,
    direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
  };
}
