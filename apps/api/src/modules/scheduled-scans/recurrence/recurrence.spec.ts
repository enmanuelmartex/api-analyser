import { describe, expect, it } from 'bun:test';
import {
  computeNextRun,
  computeNextRuns,
  describeCron,
  describeRecurrence,
  minimumGapMinutes,
  type RecurrenceRule,
} from './recurrence';
import {
  formatUtcOffset,
  isValidTimeZone,
  offsetMsOf,
  zonedPartsOf,
  zonedTimeToUtc,
} from './zoned-time';

/**
 * The tests that matter most in this module.
 *
 * `nextRunAt` is a promise made to an operator in the UI, and it is written to
 * the database. Getting it wrong does not throw — it silently scans a
 * production API at the wrong hour, or never scans it at all. Every case below
 * is one where a plausible implementation is quietly wrong: DST in both
 * directions, month-end, the boundary between "due now" and "due next", and the
 * pause/resume rule that must not replay a backlog.
 */

/** Reads an instant back as a wall clock, which is how a user judges it. */
function wall(instant: Date | null, timeZone: string): string {
  if (!instant) return 'none';
  const parts = zonedPartsOf(instant, timeZone);
  return (
    `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ` +
    `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  );
}

const SANTO_DOMINGO = 'America/Santo_Domingo'; // UTC-4 all year, no DST.
const NEW_YORK = 'America/New_York'; // DST in both directions.
const KOLKATA = 'Asia/Kolkata'; // UTC+5:30, a half-hour offset.

describe('zoned-time', () => {
  it('accepts real IANA zones and rejects everything else', () => {
    expect(isValidTimeZone(SANTO_DOMINGO)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('UTC-4')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it('reports the offset in force at a given instant, not a fixed one', () => {
    // The same zone is UTC-5 in January and UTC-4 in July. A schedule that
    // stored one of them would be an hour out for half the year.
    expect(offsetMsOf(new Date('2026-01-15T12:00:00Z'), NEW_YORK)).toBe(-5 * 3_600_000);
    expect(offsetMsOf(new Date('2026-07-15T12:00:00Z'), NEW_YORK)).toBe(-4 * 3_600_000);
  });

  it('formats offsets the way the UI shows them, including half-hour zones', () => {
    expect(formatUtcOffset(SANTO_DOMINGO, new Date('2026-08-13T00:00:00Z'))).toBe('UTC-4');
    expect(formatUtcOffset(KOLKATA, new Date('2026-08-13T00:00:00Z'))).toBe('UTC+5:30');
    expect(formatUtcOffset('UTC', new Date('2026-08-13T00:00:00Z'))).toBe('UTC');
  });

  it('round-trips a wall time through UTC and back', () => {
    const instant = zonedTimeToUtc(
      { year: 2026, month: 8, day: 17, hour: 2, minute: 0 },
      SANTO_DOMINGO,
    );
    expect(instant.toISOString()).toBe('2026-08-17T06:00:00.000Z');
    expect(wall(instant, SANTO_DOMINGO)).toBe('2026-08-17 02:00');
  });

  it('resolves an ambiguous wall time to the earlier of the two instants', () => {
    // 1 November 2026, New York: 02:00 EDT falls back to 01:00 EST, so 01:30
    // happens twice. Picking the later one would make that day 25 hours long
    // for a daily schedule.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      NEW_YORK,
    );
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('shifts a nonexistent wall time forward instead of dropping the day', () => {
    // 8 March 2026, New York: 02:00 EST jumps to 03:00 EDT, so 02:30 does not
    // exist. The run must still happen that day.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      NEW_YORK,
    );
    expect(wall(instant, NEW_YORK)).toBe('2026-03-08 03:30');
  });
});

describe('computeNextRun — ONCE', () => {
  const rule = (startAt: string): RecurrenceRule => ({
    frequency: 'ONCE',
    timezone: SANTO_DOMINGO,
    startAt: new Date(startAt),
  });

  it('returns the configured instant while it is still in the future', () => {
    const next = computeNextRun(rule('2026-08-17T06:00:00Z'), new Date('2026-08-13T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-17T06:00:00.000Z');
  });

  it('returns null once it has passed, which is what completes the schedule', () => {
    expect(computeNextRun(rule('2026-08-10T06:00:00Z'), new Date('2026-08-13T10:00:00Z'))).toBeNull();
  });

  it('never returns its own input, so an occurrence cannot be dispatched twice', () => {
    const at = new Date('2026-08-17T06:00:00Z');
    expect(computeNextRun(rule(at.toISOString()), at)).toBeNull();
  });
});

describe('computeNextRun — HOURLY', () => {
  const rule = (intervalHours: number, anchor: string): RecurrenceRule => ({
    frequency: 'HOURLY',
    timezone: SANTO_DOMINGO,
    intervalHours,
    hour: 0,
    minute: 0,
    startAt: new Date(anchor),
  });

  it('advances by exactly the interval from the anchor', () => {
    const next = computeNextRun(rule(6, '2026-08-13T00:00:00Z'), new Date('2026-08-13T07:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-13T12:00:00.000Z');
  });

  it('does not replay the occurrences missed while the service was down', () => {
    // Anchor three days back with a 12-hour interval: six occurrences were
    // missed. The scheduler must produce ONE next instant, not a backlog.
    const next = computeNextRun(rule(12, '2026-08-10T00:00:00Z'), new Date('2026-08-13T05:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-13T12:00:00.000Z');
  });

  it('keeps the spacing exact across a DST change', () => {
    // New York, 8 March 2026: the wall clock loses an hour. "Every 6 hours"
    // means six hours of real time, so the gap stays 6h and the wall time
    // shifts — the opposite trade-off would produce a 5h or 7h gap.
    const hourly: RecurrenceRule = {
      frequency: 'HOURLY',
      timezone: NEW_YORK,
      intervalHours: 6,
      startAt: new Date('2026-03-08T05:00:00Z'), // 00:00 EST
    };
    const runs = computeNextRuns(hourly, 2, new Date('2026-03-08T05:00:00Z'));
    expect(runs[0].getTime() - new Date('2026-03-08T05:00:00Z').getTime()).toBe(6 * 3_600_000);
    expect(runs[1].getTime() - runs[0].getTime()).toBe(6 * 3_600_000);
  });

  it('waits for a future anchor rather than starting immediately', () => {
    const next = computeNextRun(rule(1, '2026-09-01T00:00:00Z'), new Date('2026-08-13T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('computeNextRun — DAILY', () => {
  const daily: RecurrenceRule = {
    frequency: 'DAILY',
    timezone: SANTO_DOMINGO,
    hour: 2,
    minute: 0,
  };

  it('picks today when the time has not passed yet', () => {
    const next = computeNextRun(daily, new Date('2026-08-13T01:00:00Z')); // 21:00 the 12th
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-08-13 02:00');
  });

  it('rolls to tomorrow once today has passed', () => {
    const next = computeNextRun(daily, new Date('2026-08-13T10:00:00Z')); // 06:00 local
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-08-14 02:00');
  });

  it('holds the wall-clock time across both DST transitions', () => {
    // The property a daily schedule must have: 02:00 stays 02:00, whatever the
    // UTC offset does. The stored instants differ by an hour; the clock does not.
    const nyDaily: RecurrenceRule = { frequency: 'DAILY', timezone: NEW_YORK, hour: 2, minute: 30 };

    const beforeSpring = computeNextRun(nyDaily, new Date('2026-03-06T12:00:00Z'));
    const afterSpring = computeNextRun(nyDaily, new Date('2026-03-10T12:00:00Z'));
    expect(wall(beforeSpring, NEW_YORK)).toBe('2026-03-07 02:30');
    expect(wall(afterSpring, NEW_YORK)).toBe('2026-03-11 02:30');

    const afterAutumn = computeNextRun(nyDaily, new Date('2026-11-02T12:00:00Z'));
    expect(wall(afterAutumn, NEW_YORK)).toBe('2026-11-03 02:30');
  });

  it('still runs on the day a DST gap swallows the configured time', () => {
    const nyDaily: RecurrenceRule = { frequency: 'DAILY', timezone: NEW_YORK, hour: 2, minute: 30 };
    const next = computeNextRun(nyDaily, new Date('2026-03-08T05:00:00Z')); // 00:00 EST
    // 02:30 does not exist on this date; the run happens, displaced by the gap.
    expect(wall(next, NEW_YORK)).toBe('2026-03-08 03:30');
  });

  it('handles a half-hour offset zone', () => {
    const rule: RecurrenceRule = { frequency: 'DAILY', timezone: KOLKATA, hour: 3, minute: 0 };
    const next = computeNextRun(rule, new Date('2026-08-13T00:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-13T21:30:00.000Z');
    expect(wall(next, KOLKATA)).toBe('2026-08-14 03:00');
  });
});

describe('computeNextRun — WEEKLY', () => {
  const weekly: RecurrenceRule = {
    frequency: 'WEEKLY',
    timezone: SANTO_DOMINGO,
    hour: 2,
    minute: 0,
    weekdays: [1], // Monday
  };

  it('finds the next matching weekday', () => {
    // 13 August 2026 is a Thursday; the next Monday is the 17th.
    const next = computeNextRun(weekly, new Date('2026-08-13T10:00:00Z'));
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-08-17 02:00');
  });

  it('visits every selected day in order', () => {
    const monWedFri: RecurrenceRule = { ...weekly, weekdays: [1, 3, 5] };
    const runs = computeNextRuns(monWedFri, 4, new Date('2026-08-13T10:00:00Z'));
    expect(runs.map((run) => wall(run, SANTO_DOMINGO))).toEqual([
      '2026-08-14 02:00', // Friday
      '2026-08-17 02:00', // Monday
      '2026-08-19 02:00', // Wednesday
      '2026-08-21 02:00', // Friday
    ]);
  });

  it('runs today when today matches and the time is still ahead', () => {
    const thursday: RecurrenceRule = { ...weekly, weekdays: [4] };
    const next = computeNextRun(thursday, new Date('2026-08-13T01:00:00Z'));
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-08-13 02:00');
  });

  it('has no next run when no weekday is selected', () => {
    expect(computeNextRun({ ...weekly, weekdays: [] }, new Date('2026-08-13T10:00:00Z'))).toBeNull();
  });
});

describe('computeNextRun — MONTHLY', () => {
  const monthly: RecurrenceRule = {
    frequency: 'MONTHLY',
    timezone: SANTO_DOMINGO,
    hour: 3,
    minute: 0,
    monthDay: 1,
  };

  it('runs on the configured day of the next month', () => {
    const next = computeNextRun(monthly, new Date('2026-08-13T10:00:00Z'));
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-09-01 03:00');
  });

  it('clamps to the last day of a short month instead of skipping it', () => {
    // "Day 31 of every month" must still scan the API in February. Skipping is
    // what a naive implementation does, and it silently drops a month of coverage.
    const endOfMonth: RecurrenceRule = { ...monthly, monthDay: 31 };
    const runs = computeNextRuns(endOfMonth, 3, new Date('2026-01-15T10:00:00Z'));
    expect(runs.map((run) => wall(run, SANTO_DOMINGO))).toEqual([
      '2026-01-31 03:00',
      '2026-02-28 03:00',
      '2026-03-31 03:00',
    ]);
  });

  it('clamps to 29 February in a leap year', () => {
    const endOfMonth: RecurrenceRule = { ...monthly, monthDay: 30 };
    const next = computeNextRun(endOfMonth, new Date('2028-02-01T10:00:00Z'));
    expect(wall(next, SANTO_DOMINGO)).toBe('2028-02-29 03:00');
  });
});

describe('computeNextRun — CUSTOM (cron)', () => {
  const cron = (expression: string, timezone = SANTO_DOMINGO): RecurrenceRule => ({
    frequency: 'CUSTOM',
    timezone,
    cronExpression: expression,
  });

  it('evaluates the expression in the schedule timezone, not in UTC', () => {
    // 02:00 in Santo Domingo is 06:00 UTC. An implementation that evaluated in
    // UTC would scan at 22:00 local — the classic timezone bug in a scheduler.
    const next = computeNextRun(cron('0 2 * * 1'), new Date('2026-08-13T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-17T06:00:00.000Z');
    expect(wall(next, SANTO_DOMINGO)).toBe('2026-08-17 02:00');
  });

  it('supports steps, lists and ranges', () => {
    const runs = computeNextRuns(cron('0 */6 * * *'), 4, new Date('2026-08-13T10:00:00Z'));
    expect(runs.map((run) => wall(run, SANTO_DOMINGO))).toEqual([
      '2026-08-13 12:00',
      '2026-08-13 18:00',
      '2026-08-14 00:00',
      '2026-08-14 06:00',
    ]);
  });

  it('unions day-of-month and day-of-week when both are restricted', () => {
    // The historical Vixie rule. `0 0 1 * 1` means "the 1st, and every Monday".
    const runs = computeNextRuns(cron('0 0 1 * 1'), 3, new Date('2026-08-25T10:00:00Z'));
    expect(runs.map((run) => wall(run, SANTO_DOMINGO))).toEqual([
      '2026-08-31 00:00', // Monday
      '2026-09-01 00:00', // the 1st
      '2026-09-07 00:00', // Monday
    ]);
  });

  it('returns null for a date that can never occur rather than looping', () => {
    expect(computeNextRun(cron('0 0 30 2 *'), new Date('2026-08-13T10:00:00Z'))).toBeNull();
  });

  it('returns null for an unparseable expression instead of guessing', () => {
    expect(computeNextRun(cron('not a cron'), new Date('2026-08-13T10:00:00Z'))).toBeNull();
  });
});

describe('minimumGapMinutes', () => {
  it('measures the real spacing a rule produces', () => {
    const everyMinute: RecurrenceRule = { frequency: 'CUSTOM', timezone: 'UTC', cronExpression: '* * * * *' };
    expect(minimumGapMinutes(everyMinute, new Date('2026-08-13T10:00:00Z'))).toBe(1);

    const quarterHour: RecurrenceRule = { frequency: 'CUSTOM', timezone: 'UTC', cronExpression: '*/15 * * * *' };
    expect(minimumGapMinutes(quarterHour, new Date('2026-08-13T10:00:00Z'))).toBe(15);
  });

  it('catches an uneven expression that a step-based check would miss', () => {
    // Three runs an hour, but two of them one minute apart.
    const uneven: RecurrenceRule = { frequency: 'CUSTOM', timezone: 'UTC', cronExpression: '0,1,30 * * * *' };
    expect(minimumGapMinutes(uneven, new Date('2026-08-13T10:00:00Z'))).toBe(1);
  });

  it('returns null for a rule that runs at most once', () => {
    const once: RecurrenceRule = {
      frequency: 'ONCE',
      timezone: 'UTC',
      startAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(minimumGapMinutes(once, new Date('2026-08-13T10:00:00Z'))).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('describes each structured frequency in the operator’s words', () => {
    expect(
      describeRecurrence({ frequency: 'DAILY', timezone: 'UTC', hour: 2, minute: 0 }),
    ).toBe('Every day at 2:00 AM');

    expect(
      describeRecurrence({ frequency: 'WEEKLY', timezone: 'UTC', hour: 2, minute: 0, weekdays: [1, 3] }),
    ).toBe('Every Monday and Wednesday at 2:00 AM');

    expect(
      describeRecurrence({ frequency: 'MONTHLY', timezone: 'UTC', hour: 3, minute: 0, monthDay: 1 }),
    ).toBe('Day 1 of every month at 3:00 AM');

    expect(
      describeRecurrence({ frequency: 'HOURLY', timezone: 'UTC', intervalHours: 6 }),
    ).toBe('Every 6 hours');

    expect(
      describeRecurrence({ frequency: 'HOURLY', timezone: 'UTC', intervalHours: 1 }),
    ).toBe('Every hour');

    expect(
      describeRecurrence({
        frequency: 'ONCE',
        timezone: SANTO_DOMINGO,
        startAt: new Date('2026-08-17T06:00:00Z'),
      }),
    ).toBe('Once on August 17, 2026 at 2:00 AM');
  });

  it('renders midnight and noon without a 0 o’clock', () => {
    expect(describeRecurrence({ frequency: 'DAILY', timezone: 'UTC', hour: 0, minute: 0 })).toBe(
      'Every day at 12:00 AM',
    );
    expect(describeRecurrence({ frequency: 'DAILY', timezone: 'UTC', hour: 12, minute: 30 })).toBe(
      'Every day at 12:30 PM',
    );
  });
});

describe('describeCron', () => {
  it('renders the documented example the way the product promises', () => {
    expect(describeCron('0 2 * * 1')).toBe('Every Monday at 2:00 AM');
  });

  it('renders common shapes', () => {
    expect(describeCron('0 2 * * *')).toBe('Every day at 2:00 AM');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 0 1 * *')).toBe('On day 1 of the month at 12:00 AM');
  });

  it('names an expression it cannot phrase rather than inventing a sentence', () => {
    expect(describeCron('bogus')).toBe('Custom schedule (bogus)');
  });
});
