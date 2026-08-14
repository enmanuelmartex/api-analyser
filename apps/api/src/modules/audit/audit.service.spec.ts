import { describe, expect, it } from 'bun:test';
import { AuditService } from './audit.service';
import { REDACTED } from '../../common/utils/redact.util';

/**
 * Writing, filtering and deleting.
 *
 * The behaviours pinned here are the ones a defect would make silently wrong:
 * an event suppressed that should never be suppressible, a credential written
 * to the table, a filter that quietly matches everything, or a retention pass
 * that issues one unbounded DELETE against a table with a million rows.
 */

interface Harness {
  service: AuditService;
  created: any[];
  published: any[];
  findManyCalls: any[];
  deleteCalls: any[];
}

function makeService(
  options: {
    collectionEnabled?: boolean;
    liveStreamEnabled?: boolean;
    /** Successive results for the batched `findMany` in deleteOlderThan. */
    batches?: { id: string }[][];
    count?: number;
  } = {},
): Harness {
  const created: any[] = [];
  const published: any[] = [];
  const findManyCalls: any[] = [];
  const deleteCalls: any[] = [];
  const batches = [...(options.batches ?? [])];

  const prisma = {
    auditLog: {
      create: async ({ data }: any) => {
        created.push(data);
        return {
          id: `log-${created.length}`,
          createdAt: new Date(),
          user: null,
          ...data,
        };
      },
      count: async () => options.count ?? 0,
      findMany: async (args: any) => {
        findManyCalls.push(args);
        return batches.length ? (batches.shift() ?? []) : [];
      },
      deleteMany: async (args: any) => {
        deleteCalls.push(args);
        return { count: args.where.id.in.length };
      },
      findFirst: async () => null,
      groupBy: async () => [],
    },
    $queryRaw: async () => [{ size: 4096n }],
  };

  const settings = {
    getBoolean: async (key: string) =>
      key === 'logs.collectionEnabled'
        ? (options.collectionEnabled ?? true)
        : (options.liveStreamEnabled ?? true),
    getNumber: async () => 30,
  };

  const stream = {
    publish: (log: any) => published.push(log),
    subscriberCount: 0,
  };

  return {
    service: new AuditService(prisma as any, settings as any, stream as any),
    created,
    published,
    findManyCalls,
    deleteCalls,
  };
}

describe('record', () => {
  it('writes the event and pushes it to the live stream', async () => {
    const { service, created, published } = makeService();

    await service.record({ event: 'scan.completed', category: 'SCANS', message: 'Done' });

    expect(created).toHaveLength(1);
    expect(created[0].event).toBe('scan.completed');
    expect(published).toHaveLength(1);
  });

  it('suppresses routine events when collection is off', async () => {
    const { service, created } = makeService({ collectionEnabled: false });

    await service.record({ event: 'api.request', category: 'API', severity: 'INFO' });

    expect(created).toHaveLength(0);
  });

  it.each([
    ['AUTHENTICATION', 'auth.login.failed'],
    ['SECURITY', 'security.warning'],
    ['CONFIGURATION', 'settings.changed'],
  ] as const)(
    'still records %s events when collection is off',
    async (category, event) => {
      // An administrator must not be able to switch off their own audit trail.
      const { service, created } = makeService({ collectionEnabled: false });

      await service.record({ event, category, severity: 'INFO' });

      expect(created).toHaveLength(1);
    },
  );

  it('still records errors when collection is off, whatever their category', async () => {
    const { service, created } = makeService({ collectionEnabled: false });

    await service.record({ event: 'worker.crashed', category: 'WORKER', severity: 'ERROR' });
    await service.record({ event: 'db.lost', category: 'DATABASE', severity: 'CRITICAL' });

    expect(created).toHaveLength(2);
  });

  it('does not publish when live streaming is off, but still writes the row', async () => {
    const { service, created, published } = makeService({ liveStreamEnabled: false });

    await service.record({ event: 'scan.completed', category: 'SCANS' });

    expect(created).toHaveLength(1);
    expect(published).toHaveLength(0);
  });

  it('sanitises before writing, not after', async () => {
    const { service, created } = makeService();

    await service.record({
      event: 'api.request',
      category: 'API',
      route: '/api/v1/audit/logs/stream?token=eyJhbGciOiJIUzI1NiJ9.abc.def',
      metadata: { password: 'hunter2' },
    });

    expect(created[0].route).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect((created[0].metadata as any).password).toBe(REDACTED);
  });

  it('keeps the legacy `success` flag in step with the new status', async () => {
    const { service, created } = makeService();

    await service.record({ event: 'auth.login.failed', category: 'AUTHENTICATION', status: 'FAILED' });
    await service.record({ event: 'auth.login.succeeded', category: 'AUTHENTICATION', status: 'SUCCESS' });

    expect(created[0].success).toBe(false);
    expect(created[1].success).toBe(true);
  });

  it('defaults the resource to the event‘s first segment', async () => {
    const { service, created } = makeService();

    await service.record({ event: 'report.generated', category: 'REPORTS' });

    expect(created[0].resource).toBe('report');
  });

  it('never throws back into the caller when the write fails', async () => {
    // Logging must not be able to fail the operation being logged.
    const { service } = makeService();
    (service as any).prisma.auditLog.create = async () => {
      throw new Error('database is down');
    };

    await expect(
      service.record({ event: 'scan.completed', category: 'SCANS' }),
    ).resolves.toBeUndefined();
  });
});

describe('legacy log()', () => {
  it('maps the old CRUD shape onto an event name and category', async () => {
    const { service, created } = makeService();

    service.log({ userId: 'u1', action: 'LOGIN', resource: 'auth', resourceId: 'u1' });
    await Bun.sleep(5); // fire-and-forget

    expect(created[0].event).toBe('auth.login');
    expect(created[0].category).toBe('AUTHENTICATION');
    expect(created[0].action).toBe('LOGIN');
  });

  it('records a failed legacy call as FAILED/WARNING', async () => {
    const { service, created } = makeService();

    service.log({ action: 'DELETE', resource: 'user', success: false });
    await Bun.sleep(5);

    expect(created[0].status).toBe('FAILED');
    expect(created[0].severity).toBe('WARNING');
  });
});

describe('findAll filters', () => {
  it('clamps the page size so a client cannot ask for the whole table', async () => {
    const { service, findManyCalls } = makeService();

    await service.findAll({ limit: 100_000 });

    expect(findManyCalls[0].take).toBeLessThanOrEqual(200);
  });

  it('builds an inclusive date window from both bounds', async () => {
    const { service, findManyCalls } = makeService();
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-13T00:00:00Z');

    await service.findAll({ from, to });

    expect(findManyCalls[0].where.createdAt).toEqual({ gte: from, lte: to });
  });

  it('applies severity and category as IN clauses', async () => {
    const { service, findManyCalls } = makeService();

    await service.findAll({ severities: ['ERROR', 'CRITICAL'], categories: ['SCANS'] });

    expect(findManyCalls[0].where.severity).toEqual({ in: ['ERROR', 'CRITICAL'] });
    expect(findManyCalls[0].where.category).toEqual({ in: ['SCANS'] });
  });

  it('searches across the fields an investigator actually types in', async () => {
    const { service, findManyCalls } = makeService();

    await service.findAll({ search: 'req_8f429bf' });

    const fields = findManyCalls[0].where.OR.flatMap((clause: any) => Object.keys(clause));
    expect(fields).toContain('requestId');
    expect(fields).toContain('ipAddress');
    expect(fields).toContain('message');
    expect(fields).toContain('route');
  });

  it('adds no predicates at all when nothing is filtered', async () => {
    const { service, findManyCalls } = makeService();

    await service.findAll({});

    expect(findManyCalls[0].where).toEqual({});
  });

  it('adds createdAt as a secondary sort key so pages are stable', async () => {
    // severity ties constantly; without a tiebreak the same row can appear on
    // two pages and another on none.
    const { service, findManyCalls } = makeService();

    await service.findAll({ sortBy: 'severity', sortDir: 'asc' });

    expect(findManyCalls[0].orderBy).toEqual([{ severity: 'asc' }, { createdAt: 'desc' }]);
  });
});

describe('deleteOlderThan', () => {
  it('deletes in batches rather than one unbounded statement', async () => {
    // A single DELETE over a large table takes a long row-level lock and bloats
    // the WAL, which on a busy instance is felt as the API stalling.
    const { service, deleteCalls } = makeService({
      batches: [
        Array.from({ length: 5_000 }, (_, i) => ({ id: `a${i}` })),
        Array.from({ length: 5_000 }, (_, i) => ({ id: `b${i}` })),
        Array.from({ length: 120 }, (_, i) => ({ id: `c${i}` })),
      ],
    });

    const deleted = await service.deleteOlderThan(new Date('2026-08-01T00:00:00Z'));

    expect(deleted).toBe(10_120);
    expect(deleteCalls).toHaveLength(3);
  });

  it('stops immediately when nothing is old enough', async () => {
    const { service, deleteCalls } = makeService({ batches: [[]] });

    expect(await service.deleteOlderThan(new Date())).toBe(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it('respects maxBatches so one run cannot become unbounded', async () => {
    const full = () => Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` }));
    const { service, deleteCalls } = makeService({
      batches: [full(), full(), full(), full(), full()],
    });

    await service.deleteOlderThan(new Date(), { batchSize: 10, maxBatches: 2 });

    expect(deleteCalls).toHaveLength(2);
  });
});

describe('enforceMaxRecords', () => {
  it('does nothing when the table is under the ceiling', async () => {
    const { service, deleteCalls } = makeService({ count: 100 });

    expect(await service.enforceMaxRecords(500)).toBe(0);
    expect(deleteCalls).toHaveLength(0);
  });
});
