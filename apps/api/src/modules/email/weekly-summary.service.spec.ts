import { describe, expect, it } from 'bun:test';
import { WeeklySummaryService } from './weekly-summary.service';

/**
 * The digest's arithmetic.
 *
 * The queries are stubbed, but the WINDOWS they are called with are asserted —
 * that is the part with a real failure mode. A summary that quietly counts the
 * wrong seven days is indistinguishable from a correct one until somebody
 * checks the numbers by hand.
 */

interface Options {
  timeZone?: string | null;
  projects?: { id: string }[];
  /** Assessment counts, keyed by the window's ISO start. */
  assessmentCounts?: Record<string, number>;
  sums?: Record<string, { totalFindings: number | null; criticalCount: number | null }>;
  activeProjects?: number;
  appUrl?: string;
}

function makeService(options: Options = {}) {
  const assessmentWhere: any[] = [];
  const summaryWhere: any[] = [];

  const counts = options.assessmentCounts ?? {};
  const sums = options.sums ?? {};

  const prisma = {
    user: {
      findUnique: async () => ({
        timeZone: options.timeZone === undefined ? 'America/Santo_Domingo' : options.timeZone,
      }),
    },
    project: {
      findMany: async () => options.projects ?? [{ id: 'proj_1' }, { id: 'proj_2' }],
      count: async () => options.activeProjects ?? 2,
    },
    assessment: {
      count: async ({ where }: any) => {
        assessmentWhere.push(where);
        return counts[where.completedAt.gte.toISOString()] ?? 0;
      },
    },
    assessmentSummary: {
      aggregate: async ({ where }: any) => {
        summaryWhere.push(where);
        const key = where.assessment.completedAt.gte.toISOString();
        return { _sum: sums[key] ?? { totalFindings: null, criticalCount: null } };
      },
    },
  };

  const config = {
    get: (key: string) =>
      key === 'email.appUrl'
        ? options.appUrl === undefined
          ? 'https://scan.example.com'
          : options.appUrl
        : undefined,
  };

  return {
    service: new WeeklySummaryService(prisma as any, config as any),
    assessmentWhere,
    summaryWhere,
  };
}

/** Monday 14 September 2026, 13:00 UTC — 09:00 in Santo Domingo. */
const MONDAY = new Date('2026-09-14T13:00:00Z');

/** Boundaries of the reported week, in Santo Domingo (UTC-4). */
const WEEK_START = '2026-09-07T04:00:00.000Z';
const PRIOR_START = '2026-08-31T04:00:00.000Z';

describe('WeeklySummaryService.compute', () => {
  it('reports the last complete week in the user own timezone', async () => {
    const { service } = makeService();

    const summary = await service.compute('user_1', MONDAY);

    expect(summary!.week.fromDate).toBe('2026-09-07');
    expect(summary!.week.toDate).toBe('2026-09-13');
  });

  it('queries exactly two adjacent seven-day windows', async () => {
    const { service, assessmentWhere } = makeService();

    await service.compute('user_1', MONDAY);

    expect(assessmentWhere).toHaveLength(2);
    const [current, prior] = assessmentWhere;

    expect(current.completedAt.gte.toISOString()).toBe(WEEK_START);
    expect(prior.completedAt.gte.toISOString()).toBe(PRIOR_START);
    // The prior window ends exactly where the reported one begins: no overlap,
    // so nothing is counted twice, and no gap, so nothing is lost between them.
    expect(prior.completedAt.lt.toISOString()).toBe(WEEK_START);
  });

  /*
   * An upper bound has to be exclusive.
   *
   * A closed bound ("Sunday 23:59:59.999") has to pick a precision, and
   * whatever it picks, a row falling in the gap is silently dropped from both
   * weeks. `lt` has no gap.
   */
  it('bounds each window with an exclusive upper edge', async () => {
    const { service, assessmentWhere } = makeService();

    await service.compute('user_1', MONDAY);

    for (const where of assessmentWhere) {
      expect(where.completedAt.lt).toBeDefined();
      expect(where.completedAt.lte).toBeUndefined();
    }
  });

  /*
   * A failed or cancelled run produced no meaningful numbers — its summary row
   * can hold a null score and zero counts — so counting it would report work
   * that did not happen.
   */
  it('counts only completed assessments', async () => {
    const { service, assessmentWhere, summaryWhere } = makeService();

    await service.compute('user_1', MONDAY);

    for (const where of assessmentWhere) expect(where.status).toBe('COMPLETED');
    for (const where of summaryWhere) expect(where.assessment.status).toBe('COMPLETED');
  });

  /*
   * The scoping rule. A digest that mixed in another user's projects would leak
   * both their existence and their security posture.
   */
  it('scopes every query to the user own projects', async () => {
    const { service, assessmentWhere, summaryWhere } = makeService({
      projects: [{ id: 'proj_1' }, { id: 'proj_2' }],
    });

    await service.compute('user_1', MONDAY);

    for (const where of assessmentWhere) {
      expect(where.projectId).toEqual({ in: ['proj_1', 'proj_2'] });
    }
    for (const where of summaryWhere) {
      expect(where.assessment.projectId).toEqual({ in: ['proj_1', 'proj_2'] });
    }
  });

  it('computes the week-over-week change from real counts', async () => {
    const { service } = makeService({
      assessmentCounts: { [WEEK_START]: 14, [PRIOR_START]: 10 },
      sums: {
        [WEEK_START]: { totalFindings: 23, criticalCount: 3 },
        [PRIOR_START]: { totalFindings: 25, criticalCount: 3 },
      },
    });

    const summary = await service.compute('user_1', MONDAY);

    expect(summary!.assessments).toEqual({ count: 14, changePercent: 40 });
    expect(summary!.findings).toEqual({ count: 23, changePercent: -8 });
    expect(summary!.critical).toEqual({ count: 3, changePercent: 0 });
  });

  /*
   * The requirement from the brief. A first week has no baseline, and every
   * naive percentage against zero reaches the inbox as "Infinity%".
   */
  it('reports a null change rather than Infinity for a first week', async () => {
    const { service } = makeService({
      assessmentCounts: { [WEEK_START]: 7, [PRIOR_START]: 0 },
      sums: {
        [WEEK_START]: { totalFindings: 12, criticalCount: 1 },
        [PRIOR_START]: { totalFindings: 0, criticalCount: 0 },
      },
    });

    const summary = await service.compute('user_1', MONDAY);

    expect(summary!.assessments).toEqual({ count: 7, changePercent: null });
    expect(summary!.findings).toEqual({ count: 12, changePercent: null });
    expect(summary!.critical).toEqual({ count: 1, changePercent: null });
  });

  /*
   * `_sum` is null over an empty set — the normal state of a quiet week. It has
   * to read as 0 rather than propagating into the arithmetic, where it would
   * become NaN.
   */
  it('treats an empty aggregate as zero, not as null', async () => {
    const { service } = makeService({
      assessmentCounts: { [WEEK_START]: 0, [PRIOR_START]: 0 },
    });

    const summary = await service.compute('user_1', MONDAY);

    expect(summary!.findings.count).toBe(0);
    expect(summary!.critical.count).toBe(0);
    expect(Number.isNaN(summary!.findings.count)).toBe(false);
  });

  it('flags a wholly empty week so the processor can decline to send', async () => {
    const { service } = makeService({
      assessmentCounts: { [WEEK_START]: 0, [PRIOR_START]: 0 },
      activeProjects: 0,
    });

    expect((await service.compute('user_1', MONDAY))!.isEmpty).toBe(true);
  });

  it('does not flag a quiet week between two busy ones', async () => {
    // Nothing ran this week, but the week before was busy — "you ran nothing"
    // is real information here, so the digest should still go out.
    const { service } = makeService({
      assessmentCounts: { [WEEK_START]: 0, [PRIOR_START]: 9 },
      activeProjects: 0,
    });

    expect((await service.compute('user_1', MONDAY))!.isEmpty).toBe(false);
  });

  it('returns nothing at all for a user with no projects', async () => {
    const { service } = makeService({ projects: [] });

    expect(await service.compute('user_1', MONDAY)).toBeNull();
  });

  it('falls back to the system zone for a user who has not chosen one', async () => {
    const { service } = makeService({ timeZone: null });

    // Must not throw, and must still produce a week.
    const summary = await service.compute('user_1', MONDAY);
    expect(summary!.week.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('WeeklySummaryService.dashboardUrl', () => {
  it('builds an absolute link from the configured app URL', () => {
    expect(makeService().service.dashboardUrl()).toBe('https://scan.example.com/dashboard');
  });

  it('tolerates a trailing slash', () => {
    expect(makeService({ appUrl: 'https://scan.example.com/' }).service.dashboardUrl()).toBe(
      'https://scan.example.com/dashboard',
    );
  });

  /*
   * The relay rejects a relative link with a 400, and a broken button helps
   * nobody — the template omits it entirely when there is nothing to link to.
   */
  it('returns nothing when the install has no app URL', () => {
    expect(makeService({ appUrl: '' }).service.dashboardUrl()).toBeUndefined();
  });

  it('refuses a non-http scheme', () => {
    expect(makeService({ appUrl: 'javascript:alert(1)' }).service.dashboardUrl()).toBeUndefined();
    expect(makeService({ appUrl: 'not a url' }).service.dashboardUrl()).toBeUndefined();
  });
});
