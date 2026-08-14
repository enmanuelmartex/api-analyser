import { describe, expect, it } from 'bun:test';
import { Prisma } from '@prisma/client';
import { ScheduleDispatcherService } from './schedule-dispatcher.service';

/**
 * The dispatcher's job is to decide whether to scan, and these are the ways it
 * can be wrong in production:
 *
 *  - Start two scans for one occurrence, because two API instances raced.
 *  - Start a scan while the previous one is still hammering the same API.
 *  - Stop scheduling forever because one run failed.
 *  - Move the next automatic run because somebody pressed "Run now".
 *
 * Each has a test below. None of them is observable in a normal manual test —
 * the race needs two processes and the failure needs a broken project — which
 * is exactly why they are asserted here.
 */

const SCHEDULE = {
  id: 'sched-1',
  name: 'Weekly Production Scan',
  projectId: 'proj-1',
  status: 'ACTIVE',
  frequency: 'DAILY' as const,
  timezone: 'America/Santo_Domingo',
  hour: 2,
  minute: 0,
  intervalHours: null,
  weekdays: [] as number[],
  monthDay: null,
  cronExpression: null,
  startAt: null,
  nextRunAt: new Date('2026-08-13T06:00:00Z'),
  skipIfRunning: true,
  executionMode: 'all',
  scanProfileId: null,
  manualPlugins: [] as string[],
  enableAiAnalysis: true,
  maxRequestsPerEndpoint: 10,
  requestDelayMs: 200,
  timeoutMs: 10_000,
} as any;

interface HarnessOptions {
  /** 0 simulates another instance having claimed the occurrence first. */
  claimCount?: number;
  /** An assessment already in flight for this schedule. */
  inFlight?: { id: string; status: string } | null;
  /** Make the execution insert fail the way the unique constraint would. */
  duplicateExecution?: boolean;
  /** Make the scan pipeline reject. */
  createAndRunError?: string;
  schedule?: any;
}

function makeHarness(options: HarnessOptions = {}) {
  const schedule = options.schedule ?? SCHEDULE;
  const scheduleUpdates: any[] = [];
  const claimAttempts: any[] = [];
  const executionInserts: any[] = [];
  const executionUpdates: any[] = [];
  const createAndRunCalls: any[] = [];
  const events: { name: string; payload: any }[] = [];

  const prisma = {
    scheduledScan: {
      findUnique: async () => schedule,
      updateMany: async (args: any) => {
        claimAttempts.push(args);
        return { count: options.claimCount ?? 1 };
      },
      update: async (args: any) => {
        scheduleUpdates.push(args);
        return { consecutiveFailures: 3 };
      },
    },
    scheduleExecution: {
      create: async (args: any) => {
        if (options.duplicateExecution) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        executionInserts.push(args);
        return { id: 'exec-1' };
      },
      update: async (args: any) => {
        executionUpdates.push(args);
        return { id: 'exec-1' };
      },
    },
    assessment: {
      findFirst: async () => options.inFlight ?? null,
    },
    project: {
      findUnique: async () => ({ id: 'proj-1', name: 'Payment API', userId: 'owner-1' }),
    },
    // Prisma's array form runs the prepared queries together; the fakes above
    // already return promises, so awaiting them all is faithful enough.
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  const assessments = {
    createAndRun: async (...args: any[]) => {
      createAndRunCalls.push(args);
      if (options.createAndRunError) throw new Error(options.createAndRunError);
      return { id: 'assessment-1' };
    },
  };

  const eventEmitter = {
    emit: (name: string, payload: any) => {
      events.push({ name, payload });
      return true;
    },
  };

  const dispatcher = new ScheduleDispatcherService(
    prisma as any,
    assessments as any,
    eventEmitter as any,
  );

  return {
    dispatcher,
    schedule,
    claimAttempts,
    scheduleUpdates,
    executionInserts,
    executionUpdates,
    createAndRunCalls,
    events,
    eventNames: () => events.map((event) => event.name),
  };
}

describe('dispatchDue — claiming the occurrence', () => {
  it('claims with a compare-and-swap on the exact nextRunAt it read', () => {
    // This is the multi-instance guarantee. The WHERE clause must pin the value
    // being replaced, or two instances both "succeed" and both scan.
    const harness = makeHarness();
    return harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z')).then(() => {
      expect(harness.claimAttempts).toHaveLength(1);
      expect(harness.claimAttempts[0].where).toMatchObject({
        id: 'sched-1',
        status: 'ACTIVE',
        nextRunAt: SCHEDULE.nextRunAt,
      });
    });
  });

  it('advances nextRunAt past the occurrence it just took', async () => {
    const harness = makeHarness();
    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    const next = harness.claimAttempts[0].data.nextRunAt as Date;
    // Daily at 02:00 Santo Domingo = 06:00Z, and the one just dispatched is
    // gone — so the next is tomorrow, not a re-run of today.
    expect(next.toISOString()).toBe('2026-08-14T06:00:00.000Z');
  });

  it('does nothing at all when another instance won the claim', async () => {
    const harness = makeHarness({ claimCount: 0 });

    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.claimed).toBe(false);
    // The decisive assertion: the loser must not create an execution, must not
    // start a scan, and must not announce anything.
    expect(harness.executionInserts).toHaveLength(0);
    expect(harness.createAndRunCalls).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
  });

  it('completes a schedule whose rule has no further occurrence', async () => {
    const once = {
      ...SCHEDULE,
      frequency: 'ONCE',
      startAt: new Date('2026-08-13T06:00:00Z'),
      nextRunAt: new Date('2026-08-13T06:00:00Z'),
    };
    const harness = makeHarness({ schedule: once });

    await harness.dispatcher.dispatchDue(once, new Date('2026-08-13T06:00:05Z'));

    expect(harness.claimAttempts[0].data.nextRunAt).toBeNull();
    expect(harness.claimAttempts[0].data.status).toBe('COMPLETED');
  });

  it('does not replay the occurrences missed while the service was down', async () => {
    // Four days late. The next run must be the next real occurrence from now —
    // not the day after the missed one, which would walk the backlog forward
    // one tick at a time and fire four scans.
    const stale = { ...SCHEDULE, nextRunAt: new Date('2026-08-09T06:00:00Z') };
    const harness = makeHarness({ schedule: stale });

    await harness.dispatcher.dispatchDue(stale, new Date('2026-08-13T10:00:00Z'));

    expect((harness.claimAttempts[0].data.nextRunAt as Date).toISOString()).toBe(
      '2026-08-14T06:00:00.000Z',
    );
    // The missed occurrence still runs — once.
    expect(harness.createAndRunCalls).toHaveLength(1);
  });
});

describe('dispatchDue — the duplicate guard', () => {
  it('starts no scan when the occurrence is already in the executions table', async () => {
    // The database-level backstop: reached when the compare-and-swap was
    // bypassed entirely, e.g. by a restored snapshot with a stale nextRunAt.
    const harness = makeHarness({ duplicateExecution: true });

    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.skipped).toBe(true);
    expect(harness.createAndRunCalls).toHaveLength(0);
  });

  it('records the occurrence, not the current clock, as the execution identity', async () => {
    // `scheduledFor` must be the planned instant: it is the unique key, so two
    // instances have to compute the same value or the constraint is useless.
    const harness = makeHarness();
    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:37Z'));

    expect(harness.executionInserts[0].data.scheduledFor).toEqual(SCHEDULE.nextRunAt);
    expect(harness.executionInserts[0].data.trigger).toBe('SCHEDULED');
  });
});

describe('dispatchDue — skipIfRunning', () => {
  it('skips the occurrence while the previous scan is still running', async () => {
    const harness = makeHarness({ inFlight: { id: 'assessment-0', status: 'RUNNING' } });

    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.skipped).toBe(true);
    expect(harness.createAndRunCalls).toHaveLength(0);
    // Recorded, not silently dropped: an absent row would be indistinguishable
    // from the scheduler having failed to fire.
    expect(harness.executionUpdates[0].data.status).toBe('SKIPPED');
    expect(harness.executionUpdates[0].data.reason).toContain('still running');
    expect(harness.eventNames()).toContain('schedule.run.skipped');
  });

  it('skips while the previous scan is only queued, not yet started', async () => {
    const harness = makeHarness({ inFlight: { id: 'assessment-0', status: 'QUEUED' } });

    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.skipped).toBe(true);
  });

  it('runs anyway when the operator turned the guard off', async () => {
    const harness = makeHarness({
      schedule: { ...SCHEDULE, skipIfRunning: false },
      inFlight: { id: 'assessment-0', status: 'RUNNING' },
    });

    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.skipped).toBe(false);
    expect(harness.createAndRunCalls).toHaveLength(1);
  });

  it('still advances the schedule when it skips', async () => {
    // The occurrence is claimed before the skip decision, so a schedule that
    // skips once does not immediately re-fire on the next tick.
    const harness = makeHarness({ inFlight: { id: 'assessment-0', status: 'RUNNING' } });
    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    expect((harness.claimAttempts[0].data.nextRunAt as Date).toISOString()).toBe(
      '2026-08-14T06:00:00.000Z',
    );
  });
});

describe('dispatchDue — starting the scan', () => {
  it('hands over to the ordinary assessment pipeline with the schedule config', async () => {
    const harness = makeHarness({
      schedule: {
        ...SCHEDULE,
        executionMode: 'profile',
        scanProfileId: 'full-scan',
        enableAiAnalysis: false,
      },
    });

    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    const [projectId, userId, config, provenance] = harness.createAndRunCalls[0];
    expect(projectId).toBe('proj-1');
    // Runs as the project's owner, so their per-check configuration applies —
    // the same selection their manual run would resolve.
    expect(userId).toBe('owner-1');
    expect(config).toMatchObject({ executionMode: 'profile', scanProfileId: 'full-scan', enableAiAnalysis: false });
    // The provenance that keeps the audit trail honest.
    expect(provenance).toMatchObject({
      trigger: 'SCHEDULED',
      scheduleId: 'sched-1',
      initiatedBy: 'SCHEDULER',
    });
  });

  it('links the execution to the assessment and announces the run', async () => {
    const harness = makeHarness();
    const result = await harness.dispatcher.dispatchDue(
      harness.schedule,
      new Date('2026-08-13T06:00:05Z'),
    );

    expect(result.assessmentId).toBe('assessment-1');
    expect(harness.executionUpdates[0].data.assessmentId).toBe('assessment-1');
    expect(harness.eventNames()).toContain('schedule.run.started');
  });
});

describe('dispatchDue — failure isolation', () => {
  it('keeps the schedule active when a run cannot be started', async () => {
    const harness = makeHarness({ createAndRunError: 'No endpoints found in the API specification' });

    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    // The whole point: one bad run must not disable the automation. Nothing
    // writes PAUSED, and nextRunAt was already advanced by the claim.
    const statuses = harness.scheduleUpdates.map((update) => update.data.status);
    expect(statuses).not.toContain('PAUSED');
    expect(harness.claimAttempts[0].data.nextRunAt).toBeInstanceOf(Date);
  });

  it('records the failure against the execution, with its reason', async () => {
    const harness = makeHarness({ createAndRunError: 'No endpoints found in the API specification' });

    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    expect(harness.executionUpdates[0].data.status).toBe('FAILED');
    expect(harness.executionUpdates[0].data.reason).toBe(
      'No endpoints found in the API specification',
    );
    expect(harness.eventNames()).toContain('schedule.run.failed');
  });

  it('counts consecutive start failures so an unattended schedule is visible', async () => {
    const harness = makeHarness({ createAndRunError: 'boom' });

    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    const failureUpdate = harness.scheduleUpdates.find(
      (update) => update.data.consecutiveFailures?.increment === 1,
    );
    expect(failureUpdate).toBeDefined();
  });

  it('clears the failure streak once a run starts again', async () => {
    const harness = makeHarness();

    await harness.dispatcher.dispatchDue(harness.schedule, new Date('2026-08-13T06:00:05Z'));

    const successUpdate = harness.scheduleUpdates.find(
      (update) => update.data.consecutiveFailures === 0,
    );
    expect(successUpdate).toBeDefined();
    expect(successUpdate.data.totalRuns).toMatchObject({ increment: 1 });
  });
});

describe('runNow', () => {
  it('never touches the automatic series', async () => {
    const harness = makeHarness();

    await harness.dispatcher.runNow('sched-1', 'actor-1');

    // The defining property of "Run now": no claim, so nextRunAt is untouched.
    expect(harness.claimAttempts).toHaveLength(0);
    expect(harness.createAndRunCalls).toHaveLength(1);
  });

  it('marks the run as manually initiated, while keeping the schedule provenance', async () => {
    const harness = makeHarness();

    await harness.dispatcher.runNow('sched-1', 'actor-1');

    const provenance = harness.createAndRunCalls[0][3];
    // Still SCHEDULED as a trigger — the scan belongs to the schedule and shows
    // in its history — but a person asked for it, so the audit trail says so.
    expect(provenance).toMatchObject({
      trigger: 'SCHEDULED',
      scheduleId: 'sched-1',
      initiatedBy: 'USER',
      actorId: 'actor-1',
    });
  });

  it('respects skipIfRunning, because two concurrent scans are unwelcome either way', async () => {
    const harness = makeHarness({ inFlight: { id: 'assessment-0', status: 'RUNNING' } });

    const result = await harness.dispatcher.runNow('sched-1', 'actor-1');

    expect(result.skipped).toBe(true);
    expect(harness.createAndRunCalls).toHaveLength(0);
  });
});
