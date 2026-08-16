import { describe, expect, it } from 'bun:test';
import { WeeklySummaryScheduler } from './weekly-summary.scheduler';

/**
 * What decides that a user's digest is due, and what stops it being sent twice.
 *
 * The scheduler itself sends nothing — it queues — so everything here is about
 * two questions: is this user due, and has this week already gone out.
 */

/**
 * The one refusal the real client makes that a hand-written mock does not.
 *
 * `User.email` is `String @unique` — required — and Prisma rejects a null
 * comparison against a non-nullable column with "Argument `not` must not be
 * null". A mock that returns rows for any query at all is how this scheduler
 * shipped with `email: { not: null }` in its `where`: every test passed, and
 * every tick in production threw before it looked at a single user, so no
 * digest was ever sent. Reproducing that one rule here is what makes the mock
 * able to fail.
 */
function rejectLikePrisma(where: any) {
  for (const [column, condition] of Object.entries(where ?? {})) {
    if (condition && typeof condition === 'object' && 'not' in condition) {
      if ((condition as { not: unknown }).not === null && REQUIRED_COLUMNS.has(column)) {
        throw new Error(`Argument \`not\` must not be null (on required column '${column}')`);
      }
    }
  }
}

/** Columns the schema declares non-nullable on `User`. */
const REQUIRED_COLUMNS = new Set(['email', 'name', 'role', 'isActive', 'emailVerified']);

interface Options {
  users?: any[];
  preferences?: Record<string, boolean>;
  alreadySent?: boolean;
  transportConfigured?: boolean;
  queueThrows?: boolean;
  sendHour?: number;
}

function makeScheduler(options: Options = {}) {
  const queued: { name: string; data: any; opts: any }[] = [];
  const sentKeys: string[] = [];

  const users = options.users ?? [
    { id: 'user_1', email: 'ada@example.com', timeZone: 'America/Santo_Domingo' },
  ];

  const findManyArgs: any[] = [];

  const prisma = {
    user: {
      findMany: async (args: any) => {
        findManyArgs.push(args);
        rejectLikePrisma(args?.where);
        return users;
      },
    },
  };

  const config = {
    get: (key: string) => {
      if (key === 'email.weeklySummaryEnabled') return true;
      if (key === 'email.weeklySummaryHour') return options.sendHour ?? 8;
      return undefined;
    },
  };

  const preferences = {
    wantsWeeklySummary: async () => options.preferences?.emailWeeklySummary ?? true,
  };

  const email = {
    isConfigured: () => options.transportConfigured ?? true,
    alreadySent: async (key: string) => {
      sentKeys.push(key);
      return options.alreadySent ?? false;
    },
  };

  const queue = {
    add: async (name: string, data: any, opts: any) => {
      if (options.queueThrows) throw new Error('redis unreachable');
      queued.push({ name, data, opts });
      return { id: opts.jobId };
    },
  };

  const scheduler = new WeeklySummaryScheduler(
    prisma as any,
    config as any,
    preferences as any,
    email as any,
    queue as any,
  );

  return { scheduler, queued, sentKeys, findManyArgs };
}

/** Monday 14 September 2026, 13:00 UTC — 09:00 in Santo Domingo. */
const MONDAY_MORNING = new Date('2026-09-14T13:00:00Z');

describe('WeeklySummaryScheduler.tick', () => {
  it('asks for candidates with a query the database will accept', async () => {
    const { scheduler, findManyArgs } = makeScheduler();

    // Would throw in `rejectLikePrisma` before reaching this assertion if the
    // null-check on `email` came back.
    await scheduler.tick(MONDAY_MORNING);

    expect(findManyArgs[0].where.isActive).toBe(true);
    expect(findManyArgs[0].where.email).toBeUndefined();
  });

  it('queues a digest once the local Monday has reached the send hour', async () => {
    const { scheduler, queued } = makeScheduler();

    const result = await scheduler.tick(MONDAY_MORNING);

    expect(result.queued).toBe(1);
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toEqual({
      type: 'weekly-summary',
      userId: 'user_1',
      weekStart: '2026-09-07',
    });
  });

  /*
   * 13:00 UTC is 09:00 in Santo Domingo but only 06:00 in Los Angeles. The
   * Californian user is not due yet, and a scheduler comparing the SERVER's
   * clock rather than each user's would mail them at 06:00 — or, run from a
   * server in Asia, would mail them on Sunday.
   */
  it('compares each user own clock, not the server', async () => {
    const { scheduler, queued } = makeScheduler({
      users: [
        { id: 'east', email: 'east@example.com', timeZone: 'America/Santo_Domingo' },
        { id: 'west', email: 'west@example.com', timeZone: 'America/Los_Angeles' },
      ],
    });

    await scheduler.tick(MONDAY_MORNING);

    expect(queued.map((job) => job.data.userId)).toEqual(['east']);
  });

  it('does not queue before the send hour on Monday', async () => {
    // 10:00 UTC is 06:00 in Santo Domingo — Monday, but too early.
    const { scheduler, queued } = makeScheduler();

    const result = await scheduler.tick(new Date('2026-09-14T10:00:00Z'));

    expect(result.queued).toBe(0);
    expect(queued).toHaveLength(0);
  });

  /*
   * Run on Sunday, the week in progress is NOT the one reported.
   *
   * `lastCompleteWeek` only ever returns a week that has ended, so a Sunday
   * tick targets the week before — the one already delivered on Monday. The
   * eligibility window is deliberately broad (it stays open all week so an
   * outage can be recovered from); it is the idempotency key, not the window,
   * that keeps the delivery count at one. This test pins that interaction,
   * because it is the reason the broad window is safe.
   */
  it('targets the previous week on Sunday, and finds it already delivered', async () => {
    const sunday = new Date('2026-09-13T18:00:00Z');

    const alreadyDelivered = makeScheduler({ alreadySent: true });
    await alreadyDelivered.scheduler.tick(sunday);
    expect(alreadyDelivered.queued).toHaveLength(0);
    expect(alreadyDelivered.sentKeys).toEqual([
      // The week ending Sunday 6 September — never the one still in progress.
      'weekly-summary:2026-08-31:ada@example.com',
    ]);

    // And it never reports the week the user is still living through.
    const fresh = makeScheduler();
    await fresh.scheduler.tick(sunday);
    expect(fresh.queued[0].data.weekStart).toBe('2026-08-31');
  });

  /*
   * The catch-up window. An install down all Monday would otherwise skip the
   * week permanently; instead the digest stays due for the rest of the week and
   * the idempotency key — derived from the WEEK, not the send date — keeps the
   * eventual delivery to exactly one.
   */
  it('still queues later in the week, for the same week', async () => {
    const { scheduler, queued } = makeScheduler();

    await scheduler.tick(new Date('2026-09-17T13:00:00Z'));

    expect(queued).toHaveLength(1);
    expect(queued[0].data.weekStart).toBe('2026-09-07');
  });

  it('honours a configured send hour', async () => {
    const { scheduler, queued } = makeScheduler({ sendHour: 18 });

    // 09:00 local — past the default 08:00, short of the configured 18:00.
    await scheduler.tick(MONDAY_MORNING);

    expect(queued).toHaveLength(0);
  });

  it('skips a user who has the digest switched off', async () => {
    const { scheduler, queued } = makeScheduler({
      preferences: { emailWeeklySummary: false },
    });

    const result = await scheduler.tick(MONDAY_MORNING);

    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(queued).toHaveLength(0);
  });

  it('skips a user whose digest for this week was already delivered', async () => {
    const { scheduler, queued, sentKeys } = makeScheduler({ alreadySent: true });

    await scheduler.tick(MONDAY_MORNING);

    expect(queued).toHaveLength(0);
    // Keyed on the week and the address, lower-cased — the same key a retry
    // next Wednesday would produce.
    expect(sentKeys).toEqual(['weekly-summary:2026-09-07:ada@example.com']);
  });

  it('skips a user with no address on file', async () => {
    const { scheduler, queued } = makeScheduler({
      users: [{ id: 'user_1', email: null, timeZone: 'UTC' }],
    });

    await scheduler.tick(MONDAY_MORNING);

    expect(queued).toHaveLength(0);
  });

  it('falls back to the system zone for a user who has not chosen one', async () => {
    const { scheduler } = makeScheduler({
      users: [{ id: 'user_1', email: 'ada@example.com', timeZone: null }],
    });

    // Must not throw on a null zone; whether it queues depends on the runner's
    // own timezone, which is not this test's business.
    await expect(scheduler.tick(MONDAY_MORNING)).resolves.toBeDefined();
  });

  /*
   * Layer 2 of the duplicate guard. BullMQ discards a second job carrying an id
   * already in the queue, so two replicas ticking at the same instant enqueue
   * one job between them.
   *
   * Hyphens, never colons: BullMQ reserves `:` for its own key segments and
   * throws on a custom id containing one — the trap already documented on
   * `AutoReportService`, where it produced reports that were claimed and never
   * rendered.
   */
  it('uses a deterministic job id containing no colon', async () => {
    const { scheduler, queued } = makeScheduler();

    await scheduler.tick(MONDAY_MORNING);

    expect(queued[0].opts.jobId).toBe('weekly-user_1-2026-09-07');
    expect(queued[0].opts.jobId).not.toContain(':');
  });

  it('retries with backoff rather than failing on a transient error', async () => {
    const { scheduler, queued } = makeScheduler();

    await scheduler.tick(MONDAY_MORNING);

    expect(queued[0].opts.attempts).toBe(3);
    expect(queued[0].opts.backoff).toEqual({ type: 'exponential', delay: 30_000 });
  });

  /*
   * This runs on a timer. An unreachable Redis must mean a late digest — the
   * next tick tries again, and the idempotency key makes that safe — rather
   * than an unhandled rejection that takes the process down.
   */
  it('reports a queue failure instead of throwing', async () => {
    const { scheduler } = makeScheduler({ queueThrows: true });

    const result = await scheduler.tick(MONDAY_MORNING);

    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('does not overlap itself when a tick is slow', async () => {
    const { scheduler, queued } = makeScheduler();

    const [first, second] = await Promise.all([
      scheduler.tick(MONDAY_MORNING),
      scheduler.tick(MONDAY_MORNING),
    ]);

    // One of the two returns immediately having done nothing.
    expect(first.queued + second.queued).toBe(1);
    expect(queued).toHaveLength(1);
  });
});

describe('WeeklySummaryScheduler.onModuleInit', () => {
  it('does not start a timer when no transport is configured', () => {
    const { scheduler } = makeScheduler({ transportConfigured: false });

    scheduler.onModuleInit();

    // Nothing to clean up, and no timer holding the process open.
    expect(() => scheduler.onModuleDestroy()).not.toThrow();
  });
});
