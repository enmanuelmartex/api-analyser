import { describe, expect, it } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduledScansService } from './scheduled-scans.service';
import { displayStatusOf } from './schedule-rule';

/**
 * The backend is the source of truth for what a schedule may be.
 *
 * The form applies the same rules for immediate feedback, but the API is
 * reachable without it, and this is a product whose schedules aim traffic at
 * somebody's production API. Every rule below is enforced here, not merely
 * displayed there.
 */

const PROJECT = {
  id: 'proj-1',
  name: 'Payment API',
  status: 'READY',
  apiSpec: { id: 'spec-1', _count: { endpoints: 12 } },
};

const EXISTING = {
  id: 'sched-1',
  name: 'Weekly Production Scan',
  projectId: 'proj-1',
  createdById: 'user-1',
  frequency: 'WEEKLY' as const,
  timezone: 'America/Santo_Domingo',
  hour: 2,
  minute: 0,
  intervalHours: null,
  weekdays: [1],
  monthDay: null,
  cronExpression: null,
  startAt: null,
  executionMode: 'all',
  scanProfileId: null,
  manualPlugins: [] as string[],
  enableAiAnalysis: true,
  maxRequestsPerEndpoint: 10,
  requestDelayMs: 200,
  timeoutMs: 10_000,
  status: 'ACTIVE' as string,
  skipIfRunning: true,
  nextRunAt: new Date('2026-08-17T06:00:00Z'),
  lastRunAt: null,
  totalRuns: 0,
  consecutiveFailures: 0,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  project: { id: 'proj-1', name: 'Payment API', baseUrl: 'https://api.example.com', environment: 'PRODUCTION' },
  scanProfile: null,
  createdBy: { id: 'user-1', name: 'Ana' },
  executions: [] as { status: string }[],
};

interface HarnessOptions {
  project?: any;
  existing?: any;
  profile?: any;
  knownPlugins?: string[];
  assessmentCount?: number;
  runNowResult?: any;
}

function makeHarness(options: HarnessOptions = {}) {
  const created: any[] = [];
  const updated: any[] = [];
  const deleted: string[] = [];
  const events: { name: string; payload: any }[] = [];
  const runNowCalls: string[] = [];

  const existing = options.existing === undefined ? EXISTING : options.existing;

  const prisma = {
    project: { findFirst: async () => (options.project === undefined ? PROJECT : options.project) },
    scanProfile: { findFirst: async () => options.profile ?? null },
    scheduledScan: {
      findFirst: async () => existing,
      count: async () => 1,
      findMany: async () => (existing ? [existing] : []),
      create: async ({ data }: any) => {
        created.push(data);
        return { ...EXISTING, ...data, executions: [] };
      },
      update: async ({ data }: any) => {
        updated.push(data);
        return { ...existing, ...data, project: EXISTING.project, executions: [] };
      },
      delete: async ({ where }: any) => {
        deleted.push(where.id);
        return existing;
      },
    },
    scheduleExecution: { count: async () => 3, findMany: async () => [] },
    assessment: { count: async () => options.assessmentCount ?? 4 },
  };

  const pluginRegistry = {
    has: (id: string) => (options.knownPlugins ?? ['bola', 'cors', 'security-headers']).includes(id),
  };

  const dispatcher = {
    runNow: async (id: string) => {
      runNowCalls.push(id);
      return options.runNowResult ?? { claimed: true, skipped: false, assessmentId: 'a-1', executionId: 'e-1' };
    },
  };

  const eventEmitter = {
    emit: (name: string, payload: any) => {
      events.push({ name, payload });
      return true;
    },
  };

  const service = new ScheduledScansService(
    prisma as any,
    pluginRegistry as any,
    dispatcher as any,
    eventEmitter as any,
  );

  return { service, created, updated, deleted, events, runNowCalls };
}

/** A valid create payload; individual tests override one field at a time. */
function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Weekly Production Scan',
    projectId: 'proj-1',
    frequency: 'WEEKLY',
    timezone: 'America/Santo_Domingo',
    hour: 2,
    minute: 0,
    weekdays: [1],
    ...overrides,
  } as any;
}

describe('create — recurrence validation', () => {
  it('stores a weekly schedule with its computed next run', async () => {
    const harness = makeHarness();
    const result = await harness.service.create('user-1', validCreate());

    expect(harness.created[0].nextRunAt).toBeInstanceOf(Date);
    expect(result.description).toBe('Every Monday at 2:00 AM');
    // The offset the UI shows next to the zone name.
    expect(result.timezoneOffset).toBe('UTC-4');
  });

  it('refuses a weekly schedule with no day selected', async () => {
    const harness = makeHarness();
    await expect(harness.service.create('user-1', validCreate({ weekdays: [] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a one-off scan in the past', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create(
        'user-1',
        validCreate({ frequency: 'ONCE', startAt: '2020-01-01T00:00:00Z' }),
      ),
    ).rejects.toThrow(/must be in the future/);
  });

  it('refuses a one-off scan with no instant at all', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create('user-1', validCreate({ frequency: 'ONCE' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a monthly day outside 1–31', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create('user-1', validCreate({ frequency: 'MONTHLY', monthDay: 40 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('anchors an hourly schedule so its series is reproducible', async () => {
    const harness = makeHarness();
    await harness.service.create(
      'user-1',
      validCreate({ frequency: 'HOURLY', intervalHours: 6, hour: 2, minute: 0 }),
    );

    // Without a stored anchor, "every 6 hours" would have to be measured from
    // the last run and would drift after every skipped or failed one.
    expect(harness.created[0].startAt).toBeInstanceOf(Date);
    expect(harness.created[0].intervalHours).toBe(6);
  });
});

describe('create — cron safety', () => {
  it('accepts a well-formed expression and describes it', async () => {
    const harness = makeHarness();
    const result = await harness.service.create(
      'user-1',
      validCreate({ frequency: 'CUSTOM', cronExpression: '0 2 * * 1' }),
    );

    expect(result.description).toBe('Every Monday at 2:00 AM');
  });

  it('refuses an unparseable expression, naming the field at fault', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create('user-1', validCreate({ frequency: 'CUSTOM', cronExpression: '99 * * * *' })),
    ).rejects.toThrow(/minute/);
  });

  it('refuses an expression that would scan every minute', async () => {
    // This is a vulnerability scanner. Accepting `* * * * *` because it parses
    // would turn a text box into a denial-of-service primitive.
    const harness = makeHarness();
    await expect(
      harness.service.create('user-1', validCreate({ frequency: 'CUSTOM', cronExpression: '* * * * *' })),
    ).rejects.toThrow(/at least 15 minutes apart/);
  });

  it('refuses an uneven expression a step-based check would miss', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create(
        'user-1',
        validCreate({ frequency: 'CUSTOM', cronExpression: '0,1,30 * * * *' }),
      ),
    ).rejects.toThrow(/at least 15 minutes apart/);
  });

  it('accepts exactly the floor', async () => {
    const harness = makeHarness();
    const result = await harness.service.create(
      'user-1',
      validCreate({ frequency: 'CUSTOM', cronExpression: '*/15 * * * *' }),
    );
    expect(result.description).toBe('Every 15 minutes');
  });
});

describe('create — project and scan configuration', () => {
  it('refuses a project that does not exist', async () => {
    const harness = makeHarness({ project: null });
    await expect(harness.service.create('user-2', validCreate())).rejects.toThrow(NotFoundException);
  });

  it('refuses a project that is still a draft', async () => {
    const harness = makeHarness({ project: { ...PROJECT, status: 'DRAFT' } });
    await expect(harness.service.create('user-1', validCreate())).rejects.toThrow(/Complete project setup/);
  });

  it('refuses a project with no specification imported', async () => {
    const harness = makeHarness({ project: { ...PROJECT, apiSpec: null } });
    await expect(harness.service.create('user-1', validCreate())).rejects.toThrow(/OpenAPI specification/);
  });

  it('refuses a project whose specification has no endpoints', async () => {
    const harness = makeHarness({
      project: { ...PROJECT, apiSpec: { id: 'spec-1', _count: { endpoints: 0 } } },
    });
    await expect(harness.service.create('user-1', validCreate())).rejects.toThrow(/No endpoints/);
  });

  it('refuses a profile that is neither a system profile nor the caller’s', async () => {
    const harness = makeHarness({ profile: null });
    await expect(
      harness.service.create(
        'user-1',
        validCreate({ executionMode: 'profile', scanProfileId: 'someone-elses' }),
      ),
    ).rejects.toThrow(/not available/);
  });

  it('refuses a profile with no checks in it', async () => {
    const harness = makeHarness({ profile: { id: 'p-1', enabledPlugins: [] } });
    await expect(
      harness.service.create('user-1', validCreate({ executionMode: 'profile', scanProfileId: 'p-1' })),
    ).rejects.toThrow(/no security checks/);
  });

  it('refuses a check that is not installed', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create(
        'user-1',
        validCreate({ executionMode: 'manual', manualPlugins: ['bola', 'not-a-real-check'] }),
      ),
    ).rejects.toThrow(/not available/);
  });

  it('refuses a manual selection with nothing in it', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.create('user-1', validCreate({ executionMode: 'manual', manualPlugins: [] })),
    ).rejects.toThrow(/at least one security check/);
  });

  it('never copies a profile id onto a schedule that does not use one', async () => {
    const harness = makeHarness();
    await harness.service.create(
      'user-1',
      validCreate({ executionMode: 'all', scanProfileId: 'full-scan' }),
    );

    // Storing it anyway would make the recorded configuration lie about what
    // the run will do.
    expect(harness.created[0].scanProfileId).toBeNull();
    expect(harness.created[0].manualPlugins).toEqual([]);
  });
});

describe('update', () => {
  it('rebuilds the rule from the merged state, not from the patch alone', async () => {
    // Changing only the hour of a weekly schedule must keep its weekdays;
    // validating the patch in isolation would reject it for having none.
    const harness = makeHarness();
    await harness.service.update('sched-1', 'user-1', { hour: 5 } as any);

    expect(harness.updated[0].weekdays).toEqual([1]);
    expect(harness.updated[0].hour).toBe(5);
    expect(harness.updated[0].nextRunAt).toBeInstanceOf(Date);
  });

  it('does not resume a paused schedule as a side effect of editing it', async () => {
    // Somebody paused this deliberately. An edit is not a decision to start
    // scanning a production API again.
    const harness = makeHarness({ existing: { ...EXISTING, status: 'PAUSED' } });

    await harness.service.update('sched-1', 'user-1', { hour: 5 } as any);

    expect(harness.updated[0].nextRunAt).toBeNull();
    expect(harness.updated[0].status).toBe('PAUSED');
  });

  it('makes a finished one-off runnable again when given a future instant', async () => {
    const harness = makeHarness({
      existing: { ...EXISTING, frequency: 'ONCE', status: 'COMPLETED', startAt: new Date('2026-08-01T06:00:00Z') },
    });

    await harness.service.update('sched-1', 'user-1', {
      frequency: 'ONCE',
      startAt: '2027-01-01T06:00:00Z',
    } as any);

    expect(harness.updated[0].status).toBe('ACTIVE');
    expect(harness.updated[0].nextRunAt).toEqual(new Date('2027-01-01T06:00:00Z'));
  });

  it('refuses a schedule the caller does not own', async () => {
    const harness = makeHarness({ existing: null });
    await expect(harness.service.update('sched-1', 'user-2', { hour: 5 } as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('pause and resume', () => {
  it('clears the next run when pausing, which is what actually stops it', async () => {
    const harness = makeHarness();
    await harness.service.pause('sched-1', 'user-1');

    expect(harness.updated[0]).toMatchObject({ status: 'PAUSED', nextRunAt: null });
    expect(harness.events.map((event) => event.payload.change)).toContain('paused');
  });

  it('resumes from now, without replaying the missed window', async () => {
    // A schedule paused for three weeks has twenty-one missed daily
    // occurrences. Resuming must produce ONE next run, not twenty-one scans.
    const harness = makeHarness({
      existing: { ...EXISTING, status: 'PAUSED', nextRunAt: null, frequency: 'DAILY', weekdays: [] },
    });

    await harness.service.resume('sched-1', 'user-1');

    const nextRunAt = harness.updated[0].nextRunAt as Date;
    expect(harness.updated[0].status).toBe('ACTIVE');
    expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to resume a one-off whose moment has passed, and says why', async () => {
    const harness = makeHarness({
      existing: {
        ...EXISTING,
        status: 'PAUSED',
        frequency: 'ONCE',
        startAt: new Date('2020-01-01T00:00:00Z'),
        nextRunAt: null,
      },
    });

    await expect(harness.service.resume('sched-1', 'user-1')).rejects.toThrow(/in the past/);
  });
});

describe('remove', () => {
  it('keeps the scans the schedule produced', async () => {
    // The rule that must never regress: deleting the automation must not erase
    // the security history it generated.
    const harness = makeHarness({ assessmentCount: 4 });

    const result = await harness.service.remove('sched-1', 'user-1');

    expect(result).toMatchObject({ deleted: true, assessmentsKept: 4 });
    expect(harness.deleted).toEqual(['sched-1']);
    expect(harness.events[0].payload.message).toContain('were kept');
  });

  it('refuses a schedule the caller does not own', async () => {
    const harness = makeHarness({ existing: null });
    await expect(harness.service.remove('sched-1', 'user-2')).rejects.toThrow(NotFoundException);
  });
});

describe('runNow', () => {
  it('reports the assessment it started and the unchanged next run', async () => {
    const harness = makeHarness();
    const result = await harness.service.runNow('sched-1', 'user-1');

    expect(result.assessmentId).toBe('a-1');
    expect(result.nextRunAt).toEqual(EXISTING.nextRunAt);
    expect(harness.events.map((event) => event.payload.change)).toContain('run_now');
  });

  it('surfaces a skip as an error the operator can act on', async () => {
    const harness = makeHarness({
      runNowResult: { claimed: true, skipped: true, reason: 'A scan from this schedule is already running.' },
    });

    await expect(harness.service.runNow('sched-1', 'user-1')).rejects.toThrow(/already running/);
  });
});

describe('preview', () => {
  it('describes a rule without writing anything', () => {
    const harness = makeHarness();
    const result = harness.service.preview(
      validCreate({ frequency: 'WEEKLY', weekdays: [1, 3], hour: 2, minute: 0 }),
    );

    expect(result.description).toBe('Every Monday and Wednesday at 2:00 AM');
    expect(result.nextRuns).toHaveLength(5);
    expect(harness.created).toHaveLength(0);
  });

  it('rejects an invalid rule the same way saving it would', () => {
    const harness = makeHarness();
    expect(() => harness.service.preview(validCreate({ weekdays: [] }))).toThrow(BadRequestException);
  });
});

describe('displayStatusOf', () => {
  it('reports a run in flight as RUNNING', () => {
    expect(displayStatusOf({ status: 'ACTIVE' }, { status: 'RUNNING' })).toBe('RUNNING');
    expect(displayStatusOf({ status: 'ACTIVE' }, { status: 'QUEUED' })).toBe('RUNNING');
  });

  it('never lets a run in flight override an explicit pause', () => {
    // Pausing is a decision. A scan that was already under way must not make
    // the schedule look active again.
    expect(displayStatusOf({ status: 'PAUSED' }, { status: 'RUNNING' })).toBe('PAUSED');
  });

  it('reports a failed last run on an otherwise active schedule', () => {
    expect(displayStatusOf({ status: 'ACTIVE' }, { status: 'FAILED' })).toBe('FAILED');
  });

  it('keeps COMPLETED for a finished one-off, whatever its last run did', () => {
    expect(displayStatusOf({ status: 'COMPLETED' }, { status: 'COMPLETED' })).toBe('COMPLETED');
    expect(displayStatusOf({ status: 'COMPLETED' }, { status: 'FAILED' })).toBe('COMPLETED');
  });

  it('falls back to ACTIVE for a schedule that has never run', () => {
    expect(displayStatusOf({ status: 'ACTIVE' }, null)).toBe('ACTIVE');
  });
});
