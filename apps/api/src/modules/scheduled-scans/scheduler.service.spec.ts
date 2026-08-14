import { describe, expect, it } from 'bun:test';
import { SchedulerService } from './scheduler.service';

/**
 * What must be true after the API, the worker or Redis restarts.
 *
 * Redis holds the heartbeat and can be flushed or replaced; Postgres holds the
 * schedules and is the only durable state. These tests cover the repairs that
 * make that split safe, and the one behaviour that must NOT happen on
 * recovery — replaying every occurrence missed during the outage.
 */

const ACTIVE_SCHEDULE = {
  id: 'sched-1',
  name: 'Nightly',
  projectId: 'proj-1',
  status: 'ACTIVE',
  frequency: 'DAILY' as const,
  timezone: 'UTC',
  hour: 2,
  minute: 0,
  intervalHours: null,
  weekdays: [] as number[],
  monthDay: null,
  cronExpression: null,
  startAt: null,
  nextRunAt: new Date('2026-08-13T02:00:00Z'),
  skipIfRunning: true,
} as any;

interface HarnessOptions {
  due?: any[];
  orphanedSchedules?: any[];
  pendingExecutions?: any[];
  dispatch?: (_schedule: any) => Promise<any>;
  repeatableJobs?: { name: string; key: string }[];
  /** Makes the due-schedules query throw, simulating a database outage. */
  findManyThrows?: string;
  /** Fails only the first N ticks, then recovers. */
  failFirstTicks?: number;
  /** Makes the Redis-backed cleanup throw, simulating Redis being unreachable. */
  queueThrows?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const scheduleUpdates: any[] = [];
  const executionUpdates: any[] = [];
  const queueAdds: any[] = [];
  const removedRepeatables: string[] = [];
  const dispatched: any[] = [];
  const dueQueries: any[] = [];
  let remainingFailures = options.failFirstTicks ?? 0;

  const prisma = {
    scheduledScan: {
      findMany: async (args: any) => {
        if (args?.where?.nextRunAt === null) return options.orphanedSchedules ?? [];
        if (options.findManyThrows) throw new Error(options.findManyThrows);
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('database is down');
        }
        dueQueries.push(args);
        return options.due ?? [ACTIVE_SCHEDULE];
      },
      update: async (args: any) => {
        scheduleUpdates.push(args);
        return {};
      },
    },
    scheduleExecution: {
      findMany: async () => options.pendingExecutions ?? [],
      update: async (args: any) => {
        executionUpdates.push(args);
        return {};
      },
    },
  };

  const dispatcher = {
    dispatchDue: async (schedule: any) => {
      dispatched.push(schedule);
      return (
        (await options.dispatch?.(schedule)) ?? {
          claimed: true,
          skipped: false,
          assessmentId: 'assessment-1',
        }
      );
    },
  };

  const queue = {
    getRepeatableJobs: async () => {
      if (options.queueThrows) throw new Error('Redis is unreachable');
      return options.repeatableJobs ?? [];
    },
    removeRepeatableByKey: async (key: string) => {
      removedRepeatables.push(key);
    },
    add: async (name: string, data: unknown, opts: unknown) => {
      queueAdds.push({ name, data, opts });
      return { id: name };
    },
  };

  const events: { name: string; payload: any }[] = [];
  const eventEmitter = {
    emit: (name: string, payload: any) => {
      events.push({ name, payload });
      return true;
    },
  };

  const scheduler = new SchedulerService(
    queue as any,
    prisma as any,
    dispatcher as any,
    eventEmitter as any,
  );

  return {
    scheduler,
    scheduleUpdates,
    executionUpdates,
    queueAdds,
    removedRepeatables,
    dispatched,
    dueQueries,
    events,
  };
}

describe('the heartbeat', () => {
  /**
   * THE REGRESSION.
   *
   * The heartbeat used to be a BullMQ repeatable job. BullMQ derives such a
   * job's id from its slot (`repeat:<hash>:<millis>`) and refuses to insert an
   * id that already exists — so restarting the API inside the same minute as a
   * tick that had already completed collided with the finished job, the chain
   * was never extended, and the scheduler stopped forever. Silently: the queue
   * kept a repeat CONFIG with no delayed job behind it, and every schedule went
   * on displaying "Active" next to a next-run time that had already passed.
   *
   * This was observed in production-shaped use — a restart at 23:12:09 against
   * a tick completed at 23:12:00 killed it outright. Liveness therefore no
   * longer depends on Redis bookkeeping at all.
   */
  it('does not enqueue anything to drive itself', async () => {
    const harness = makeHarness();

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    // Nothing produced onto the queue means there is no chain to break.
    expect(harness.queueAdds).toHaveLength(0);
  });

  it('starts on boot and reports itself as running', async () => {
    const harness = makeHarness();

    await harness.scheduler.onModuleInit();

    expect(harness.scheduler.getHealth().running).toBe(true);
    harness.scheduler.stop();
    expect(harness.scheduler.getHealth().running).toBe(false);
  });

  it('is idempotent, so a double init cannot double-tick', async () => {
    const harness = makeHarness();

    harness.scheduler.start();
    harness.scheduler.start();
    harness.scheduler.stop();

    expect(harness.scheduler.getHealth().running).toBe(false);
  });

  it('sweeps immediately on boot, so a restart does not swallow a due run', async () => {
    // The occurrence the user lost was due while the process was restarting.
    const harness = makeHarness({ due: [ACTIVE_SCHEDULE] });

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    expect(harness.dispatched).toHaveLength(1);
  });

  it('removes the legacy repeatable registration left by the old design', async () => {
    const harness = makeHarness({
      repeatableJobs: [
        { name: 'scheduler-tick', key: 'old-key' },
        { name: 'something-else', key: 'other-key' },
      ],
    });

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    expect(harness.removedRepeatables).toEqual(['old-key']);
  });

  it('starts even when Redis is unreachable', async () => {
    // The heartbeat no longer depends on Redis, so a Redis problem must not be
    // able to prevent schedules from running.
    const harness = makeHarness({ queueThrows: true, due: [ACTIVE_SCHEDULE] });

    await harness.scheduler.onModuleInit();

    expect(harness.scheduler.getHealth().running).toBe(true);
    expect(harness.dispatched).toHaveLength(1);
    harness.scheduler.stop();
  });
});

describe('the heartbeat — surviving failure', () => {
  it('never lets a failed tick escape into the interval callback', async () => {
    // An unhandled rejection here would take the process down and with it every
    // schedule in the installation.
    const harness = makeHarness({ findManyThrows: 'database is down' });

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    // Still armed after the failure, so the next beat retries.
    expect(harness.scheduler.getHealth().consecutiveFailures).toBe(1);
    expect(harness.scheduler.getHealth().lastError).toBe('database is down');
  });

  it('records a failed tick in the event log rather than only in a queue', async () => {
    // The old failure was invisible because it lived in a Redis key nobody
    // reads. A broken scheduler must show up where operators actually look.
    const harness = makeHarness({ findManyThrows: 'database is down' });

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    const reported = harness.events.find((event) => event.name === 'system.error');
    expect(reported).toBeDefined();
    expect(reported!.payload.event).toBe('scheduler.tick.failed');
    expect(reported!.payload.category).toBe('WORKER');
    // Notified once per streak, not once a minute.
    expect(reported!.payload.notify).toBe(true);
  });

  it('reports unhealthy while it has never completed a tick', async () => {
    const harness = makeHarness({ findManyThrows: 'database is down' });

    await harness.scheduler.onModuleInit();
    harness.scheduler.stop();

    expect(harness.scheduler.getHealth().lastTickAt).toBeNull();
  });

  it('recovers by itself once the outage passes', async () => {
    // The decisive property the old design lacked: a transient failure must not
    // be terminal. One beat fails, the next one works, and nothing had to be
    // restarted or re-registered for that to happen.
    const harness = makeHarness({ failFirstTicks: 1 });

    await harness.scheduler.onModuleInit();
    expect(harness.scheduler.getHealth().consecutiveFailures).toBe(1);
    expect(harness.scheduler.getHealth().lastTickAt).toBeNull();

    await harness.scheduler.tick(new Date('2026-08-13T02:00:30Z'));
    harness.scheduler.stop();

    // The next beat found the database again and dispatched the due schedule.
    expect(harness.dispatched).toHaveLength(1);
  });
});

describe('tick', () => {
  it('dispatches every due schedule and reports the outcome', async () => {
    const harness = makeHarness({
      due: [ACTIVE_SCHEDULE, { ...ACTIVE_SCHEDULE, id: 'sched-2' }],
    });

    const result = await harness.scheduler.tick(new Date('2026-08-13T02:00:30Z'));

    expect(harness.dispatched).toHaveLength(2);
    expect(result.due).toBe(2);
    expect(result.dispatched).toBe(2);
  });

  it('keeps going when one schedule throws', async () => {
    // One project with a broken specification must not stop every other
    // schedule in the installation from running.
    const harness = makeHarness({
      due: [ACTIVE_SCHEDULE, { ...ACTIVE_SCHEDULE, id: 'sched-2' }],
      dispatch: async (schedule) => {
        if (schedule.id === 'sched-1') throw new Error('database blip');
        return { claimed: true, skipped: false, assessmentId: 'assessment-2' };
      },
    });

    const result = await harness.scheduler.tick(new Date('2026-08-13T02:00:30Z'));

    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(1);
  });

  it('never considers a schedule whose project has been deleted', async () => {
    // Project deletion is a SOFT delete, so the schedule row survives with a
    // perfectly valid nextRunAt. Without this clause it would keep sending
    // traffic at an API the operator believes they removed.
    const harness = makeHarness({ due: [ACTIVE_SCHEDULE] });

    await harness.scheduler.tick(new Date('2026-08-13T02:00:30Z'));

    expect(harness.dueQueries[0].where.project).toEqual({ isActive: true });
  });

  it('counts a contested claim separately from a failure', async () => {
    const harness = makeHarness({
      due: [ACTIVE_SCHEDULE],
      dispatch: async () => ({ claimed: false, skipped: false }),
    });

    const result = await harness.scheduler.tick(new Date('2026-08-13T02:00:30Z'));

    expect(result.contended).toBe(1);
    expect(result.failed).toBe(0);
  });
});

describe('reconcile — after a restart', () => {
  it('recomputes the next run for an active schedule that lost it', async () => {
    // A schedule stuck at nextRunAt = null would never be dispatched again, and
    // the symptom is the worst this feature has: it quietly stops scanning.
    const harness = makeHarness({
      orphanedSchedules: [{ ...ACTIVE_SCHEDULE, nextRunAt: null }],
    });

    const result = await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(result.rescheduled).toBe(1);
    expect(harness.scheduleUpdates[0].data.nextRunAt).toEqual(new Date('2026-08-14T02:00:00Z'));
  });

  it('completes a rule that can no longer produce a run', async () => {
    const harness = makeHarness({
      orphanedSchedules: [
        {
          ...ACTIVE_SCHEDULE,
          frequency: 'ONCE',
          startAt: new Date('2026-08-01T02:00:00Z'),
          nextRunAt: null,
        },
      ],
    });

    await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(harness.scheduleUpdates[0].data).toMatchObject({ status: 'COMPLETED' });
  });

  it('copies a finished assessment outcome onto the execution that never heard back', async () => {
    const harness = makeHarness({
      pendingExecutions: [
        {
          id: 'exec-1',
          createdAt: new Date('2026-08-13T02:00:00Z'),
          assessmentId: 'assessment-1',
          assessment: {
            status: 'COMPLETED',
            completedAt: new Date('2026-08-13T02:04:00Z'),
            currentStep: 'Completed',
          },
        },
      ],
    });

    await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(harness.executionUpdates[0].data).toMatchObject({ status: 'COMPLETED' });
  });

  it('carries the failure reason across, so the history explains itself', async () => {
    const harness = makeHarness({
      pendingExecutions: [
        {
          id: 'exec-1',
          createdAt: new Date('2026-08-13T02:00:00Z'),
          assessmentId: 'assessment-1',
          assessment: {
            status: 'FAILED',
            completedAt: new Date('2026-08-13T02:01:00Z'),
            currentStep: 'Failed: target unreachable',
          },
        },
      ],
    });

    await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(harness.executionUpdates[0].data).toMatchObject({
      status: 'FAILED',
      reason: 'Failed: target unreachable',
    });
  });

  it('abandons a dispatch that died before it created a scan', async () => {
    // Left pending forever it would keep skipIfRunning from ever letting the
    // schedule run again — a single crash would silently disable the schedule.
    const harness = makeHarness({
      pendingExecutions: [
        {
          id: 'exec-1',
          createdAt: new Date('2026-08-13T02:00:00Z'),
          assessmentId: null,
          assessment: null,
        },
      ],
    });

    await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(harness.executionUpdates[0].data).toMatchObject({ status: 'FAILED' });
    expect(harness.executionUpdates[0].data.reason).toContain('restarted');
  });

  it('leaves a dispatch that is merely young alone', async () => {
    // The window has to exceed a normal enqueue, or a scan being created right
    // now would be declared dead.
    const harness = makeHarness({
      pendingExecutions: [
        {
          id: 'exec-1',
          createdAt: new Date('2026-08-13T09:59:30Z'),
          assessmentId: null,
          assessment: null,
        },
      ],
    });

    const result = await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(result.executions).toBe(0);
    expect(harness.executionUpdates).toHaveLength(0);
  });

  it('leaves a running scan running', async () => {
    const harness = makeHarness({
      pendingExecutions: [
        {
          id: 'exec-1',
          createdAt: new Date('2026-08-13T09:58:00Z'),
          assessmentId: 'assessment-1',
          assessment: { status: 'RUNNING', completedAt: null, currentStep: 'Running BOLA' },
        },
      ],
    });

    const result = await harness.scheduler.reconcile(new Date('2026-08-13T10:00:00Z'));

    expect(result.executions).toBe(0);
  });
});
