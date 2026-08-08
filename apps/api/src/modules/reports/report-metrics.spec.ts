import { describe, expect, it } from 'bun:test';
import {
  averageScore,
  averageScoreDelta,
  buildTrend,
  sumSeverities,
  trendDelta,
  type ReportedAssessment,
} from './report-metrics';

function assessment(overrides: Partial<ReportedAssessment> = {}): ReportedAssessment {
  return {
    id: 'a1',
    projectId: 'p1',
    completedAt: new Date('2026-07-27T09:00:00.000Z'),
    securityScore: 80,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: 0,
    ...overrides,
  };
}

describe('sumSeverities', () => {
  it('is zero for no reported assessments', () => {
    expect(sumSeverities([])).toEqual({
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      totalFindings: 0,
    });
  });

  it('sums each severity across assessments', () => {
    const totals = sumSeverities([
      assessment({ id: 'a', critical: 2, high: 1, total: 3 }),
      assessment({ id: 'b', medium: 4, low: 1, info: 2, total: 7 }),
    ]);
    expect(totals).toEqual({
      criticalCount: 2,
      highCount: 1,
      mediumCount: 4,
      lowCount: 1,
      infoCount: 2,
      totalFindings: 10,
    });
  });

  it('counts a scan once no matter how many report formats it was exported to', () => {
    // The input is one entry per assessment by construction. This is the
    // regression guard for the old behaviour, which folded over report ROWS and
    // so multiplied every severity by the number of formats.
    const scan = assessment({ id: 'multi-format', critical: 3, total: 3 });
    expect(sumSeverities([scan]).criticalCount).toBe(3);
  });
});

describe('averageScore', () => {
  it('excludes assessments with no score rather than substituting one', () => {
    const result = averageScore([
      assessment({ id: 'a', securityScore: 90 }),
      assessment({ id: 'b', securityScore: null }),
      assessment({ id: 'c', securityScore: 70 }),
    ]);
    expect(result).toEqual({ avgSecurityScore: 80, scoredAssessments: 2 });
  });

  it('keeps a real zero as a zero', () => {
    expect(averageScore([assessment({ securityScore: 0 })])).toEqual({
      avgSecurityScore: 0,
      scoredAssessments: 1,
    });
  });

  it('reports no score at all when nothing was scored', () => {
    expect(averageScore([assessment({ securityScore: null })])).toEqual({
      avgSecurityScore: null,
      scoredAssessments: 0,
    });
  });
});

describe('buildTrend', () => {
  const now = new Date('2026-07-27T15:00:00.000Z');

  it('emits one continuous point per day of the window', () => {
    const trend = buildTrend([], 30, now);
    expect(trend).toHaveLength(30);
    expect(trend[0].date).toBe('2026-06-28');
    expect(trend[29].date).toBe('2026-07-27');
  });

  it('marks days with no scan as zero findings and zero scans', () => {
    const trend = buildTrend([], 3, now);
    expect(trend.every((point) => point.total === 0 && point.scans === 0)).toBe(true);
  });

  it('places findings on the day their scan completed', () => {
    const trend = buildTrend(
      [assessment({ completedAt: new Date('2026-07-26T08:00:00.000Z'), critical: 2, high: 1, total: 3 })],
      3,
      now,
    );
    const day = trend.find((point) => point.date === '2026-07-26')!;
    expect(day).toMatchObject({ critical: 2, high: 1, total: 3, scans: 1 });
  });

  it('accumulates several scans landing on the same day', () => {
    const trend = buildTrend(
      [
        assessment({ id: 'a', completedAt: new Date('2026-07-27T08:00:00.000Z'), critical: 1, total: 1 }),
        assessment({ id: 'b', completedAt: new Date('2026-07-27T20:00:00.000Z'), critical: 2, total: 2 }),
      ],
      2,
      now,
    );
    expect(trend.find((point) => point.date === '2026-07-27')).toMatchObject({
      critical: 3,
      total: 3,
      scans: 2,
    });
  });

  it('ignores scans older than the window instead of clamping them onto the first day', () => {
    const trend = buildTrend(
      [assessment({ completedAt: new Date('2026-01-01T00:00:00.000Z'), critical: 99, total: 99 })],
      7,
      now,
    );
    expect(trend.reduce((sum, point) => sum + point.total, 0)).toBe(0);
  });

  /*
   * The chart bug: the tooltip read Critical 0 / High 1 / Medium 1 / Low 0, but
   * the blue Low band sat at 2 — because the areas shared a `stackId`, so each
   * series drew at the CUMULATIVE total of the ones before it. The data was
   * always right; the rendering was not.
   *
   * These lock the contract the chart depends on: every key carries its own
   * value, and nothing in the payload is a running total.
   */
  describe('series independence (Low must never carry the stack total)', () => {
    const point = () =>
      buildTrend(
        [assessment({ completedAt: new Date('2026-07-26T08:00:00.000Z'), critical: 0, high: 1, medium: 1, low: 0, total: 2 })],
        3,
        now,
      ).find((p) => p.date === '2026-07-26')!;

    it('keeps 0 / 1 / 1 / 0 exactly as detected', () => {
      expect(point()).toMatchObject({ critical: 0, high: 1, medium: 1, low: 0 });
    });

    it('reports Low as 0, not as the sum of the other severities', () => {
      const p = point();
      expect(p.low).toBe(0);
      expect(p.low).not.toBe(2);
      expect(p.low).not.toBe(p.critical + p.high + p.medium);
    });

    it('does not smuggle a cumulative total into any severity key', () => {
      const p = point();
      const cumulative = [
        p.critical,
        p.critical + p.high,
        p.critical + p.high + p.medium,
        p.critical + p.high + p.medium + p.low,
      ];
      // Only `total` is allowed to equal the running sum.
      expect(p.high).toBe(1);
      expect(p.medium).toBe(1);
      expect(cumulative[3]).toBe(p.total);
    });

    it('never swaps Medium and Low', () => {
      const p = buildTrend(
        [assessment({ completedAt: new Date('2026-07-26T08:00:00.000Z'), medium: 5, low: 2, total: 7 })],
        3,
        now,
      ).find((x) => x.date === '2026-07-26')!;
      expect(p.medium).toBe(5);
      expect(p.low).toBe(2);
    });

    it('emits explicit zeros — never undefined — on days with no scan', () => {
      for (const p of buildTrend([], 5, now)) {
        expect(p).toMatchObject({ critical: 0, high: 0, medium: 0, low: 0, total: 0, scans: 0 });
      }
    });

    it('counts a scan once no matter how many formats it was exported to', () => {
      // One assessment entry regardless of its four report rows.
      const p = buildTrend(
        [assessment({ id: 'multi', completedAt: new Date('2026-07-26T08:00:00.000Z'), high: 1, medium: 1, total: 2 })],
        3,
        now,
      ).find((x) => x.date === '2026-07-26')!;
      expect(p).toMatchObject({ high: 1, medium: 1, scans: 1 });
    });
  });
});

describe('averageScoreDelta', () => {
  const now = new Date('2026-07-27T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('reports an improvement in points and percent', () => {
    const delta = averageScoreDelta(
      [
        assessment({ id: 'prev', completedAt: daysAgo(40), securityScore: 64 }),
        assessment({ id: 'curr', completedAt: daysAgo(5), securityScore: 72 }),
      ],
      30,
      now,
    )!;
    expect(delta).toMatchObject({
      currentAverage: 72,
      previousAverage: 64,
      deltaPoints: 8,
      deltaPercent: 12.5,
      direction: 'up',
    });
  });

  it('reports a degradation as negative and down', () => {
    const delta = averageScoreDelta(
      [
        assessment({ id: 'prev', completedAt: daysAgo(40), securityScore: 80 }),
        assessment({ id: 'curr', completedAt: daysAgo(3), securityScore: 60 }),
      ],
      30,
      now,
    )!;
    expect(delta).toMatchObject({ deltaPoints: -20, direction: 'down' });
  });

  it('is flat when the average did not move', () => {
    const delta = averageScoreDelta(
      [
        assessment({ id: 'prev', completedAt: daysAgo(40), securityScore: 70 }),
        assessment({ id: 'curr', completedAt: daysAgo(2), securityScore: 70 }),
      ],
      30,
      now,
    )!;
    expect(delta).toMatchObject({ deltaPoints: 0, direction: 'flat' });
  });

  it('returns null when there is no previous period — no invented baseline', () => {
    expect(
      averageScoreDelta([assessment({ completedAt: daysAgo(5), securityScore: 72 })], 30, now),
    ).toBeNull();
  });

  it('returns null when the current period is empty', () => {
    expect(
      averageScoreDelta([assessment({ completedAt: daysAgo(45), securityScore: 72 })], 30, now),
    ).toBeNull();
  });

  it('returns null when neither period holds a scored assessment', () => {
    expect(
      averageScoreDelta(
        [
          assessment({ id: 'a', completedAt: daysAgo(40), securityScore: null }),
          assessment({ id: 'b', completedAt: daysAgo(5), securityScore: null }),
        ],
        30,
        now,
      ),
    ).toBeNull();
  });

  it('averages each assessment once — a scan exported four times does not skew it', () => {
    // The caller passes one entry per assessment; four report rows of the same
    // scan cannot appear here, which is what keeps the average honest.
    const delta = averageScoreDelta(
      [
        assessment({ id: 'prev', completedAt: daysAgo(40), securityScore: 60 }),
        assessment({ id: 'c1', completedAt: daysAgo(5), securityScore: 80 }),
        assessment({ id: 'c2', completedAt: daysAgo(4), securityScore: 60 }),
      ],
      30,
      now,
    )!;
    expect(delta.currentAverage).toBe(70);
    expect(delta.currentSampleSize).toBe(2);
    expect(delta.previousSampleSize).toBe(1);
  });

  it('omits the percentage rather than dividing by zero', () => {
    const delta = averageScoreDelta(
      [
        assessment({ id: 'prev', completedAt: daysAgo(40), securityScore: 0 }),
        assessment({ id: 'curr', completedAt: daysAgo(5), securityScore: 30 }),
      ],
      30,
      now,
    )!;
    expect(delta.deltaPoints).toBe(30);
    expect(delta.deltaPercent).toBeNull();
  });
});

describe('trendDelta', () => {
  function points(totals: number[]) {
    return totals.map((total, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total,
      scans: total > 0 ? 1 : 0,
    }));
  }

  it('reads fewer vulnerabilities as a negative change', () => {
    const delta = trendDelta(points([10, 10, 5, 5]))!;
    expect(delta).toMatchObject({ previous: 20, current: 10, changePercent: -50, direction: 'down' });
  });

  it('reads more vulnerabilities as a positive change', () => {
    const delta = trendDelta(points([4, 4, 6, 6]))!;
    expect(delta).toMatchObject({ previous: 8, current: 12, changePercent: 50, direction: 'up' });
  });

  it('is flat when nothing moved', () => {
    expect(trendDelta(points([5, 5, 5, 5]))!.direction).toBe('flat');
  });

  it('returns no delta when there is no baseline, rather than an infinite jump', () => {
    expect(trendDelta(points([0, 0, 7, 7]))).toBeNull();
    expect(trendDelta(points([1]))).toBeNull();
  });
});
