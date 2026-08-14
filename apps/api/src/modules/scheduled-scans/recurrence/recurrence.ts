/**
 * When does a schedule run next?
 *
 * One pure function — `computeNextRun` — with no clock of its own, no database
 * and no state. `from` is always passed in. That is what makes DST behaviour,
 * month-end clamping and the pause/resume rules testable without waiting for a
 * calendar, and it is why the scheduler can ask the same question from any
 * process and get the same answer.
 *
 * Every returned instant is STRICTLY AFTER `from`. The scheduler relies on
 * that: it computes the next occurrence from the one it just dispatched, so a
 * function that could return its own input would dispatch the same occurrence
 * forever.
 */

import {
  addCalendarDays,
  daysInMonth,
  weekdayOf,
  zonedPartsOf,
  zonedTimeToUtc,
} from './zoned-time';
import { cronMatchesDate, parseCron, type CronFields } from './cron';

export type Frequency = 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

/**
 * The recurrence rule, exactly as stored on `ScheduledScan`.
 *
 * Structurally identical to the model's columns so the service can pass a row
 * straight in — there is no mapping layer to drift.
 */
export interface RecurrenceRule {
  frequency: Frequency;
  timezone: string;
  hour?: number | null;
  minute?: number | null;
  intervalHours?: number | null;
  weekdays?: number[] | null;
  monthDay?: number | null;
  cronExpression?: string | null;
  /** ONCE: the instant itself. Others: an optional "not before" bound. */
  startAt?: Date | null;
}

/**
 * How far ahead the calendar search will look before giving up.
 *
 * Four years covers the pathological legitimate case (29 February in a cron
 * expression) with room to spare, and bounds the loop so a rule that can never
 * match — `0 0 30 2 *`, the 30th of February — returns null instead of running
 * forever.
 */
const MAX_SEARCH_DAYS = 366 * 4;

/** Minimum spacing the product will accept between two automatic scans. */
export const MIN_INTERVAL_MINUTES = 15;

/** Hourly intervals the UI offers, plus the bounds a custom interval must obey. */
export const HOURLY_PRESETS = [1, 2, 4, 6, 12] as const;
export const MIN_INTERVAL_HOURS = 1;
export const MAX_INTERVAL_HOURS = 23;

/**
 * The first occurrence strictly after `from`, or null when there is none.
 *
 * Null is a real answer, not an error: a ONCE schedule whose instant has passed
 * has no next run, and that is precisely what marks it COMPLETED.
 */
export function computeNextRun(rule: RecurrenceRule, from: Date = new Date()): Date | null {
  const notBefore = rule.startAt && rule.startAt > from ? rule.startAt : from;

  switch (rule.frequency) {
    case 'ONCE':
      return rule.startAt && rule.startAt > from ? rule.startAt : null;
    case 'HOURLY':
      return nextHourly(rule, from);
    case 'DAILY':
      return nextByCalendar(rule, notBefore, from, () => true);
    case 'WEEKLY': {
      const weekdays = new Set(rule.weekdays ?? []);
      if (weekdays.size === 0) return null;
      return nextByCalendar(rule, notBefore, from, (date) => weekdays.has(weekdayOf(date)));
    }
    case 'MONTHLY':
      return nextMonthly(rule, notBefore, from);
    case 'CUSTOM':
      return nextCron(rule, notBefore, from);
    default:
      return null;
  }
}

/**
 * HOURLY is an ELAPSED-TIME rule, not a wall-clock one.
 *
 * "Every 6 hours" means six hours of real time, so it is computed as a fixed
 * offset from an anchor rather than by matching a clock face. The consequence
 * is deliberate: across a DST change the run drifts by an hour on the wall
 * clock but the spacing stays exactly six hours, which is what an operator
 * asking for a scan every six hours actually wants. Wall-clock matching would
 * instead produce a five- or seven-hour gap.
 *
 * The anchor is `startAt` — set at creation from the chosen time of day — so
 * the series is reproducible from stored data alone and never drifts by
 * accumulating rounding from the previous run.
 */
function nextHourly(rule: RecurrenceRule, from: Date): Date | null {
  const intervalHours = rule.intervalHours ?? 1;
  if (!Number.isInteger(intervalHours) || intervalHours < 1) return null;

  const intervalMs = intervalHours * 3_600_000;
  const anchor = rule.startAt ?? nextByCalendar(rule, from, from, () => true);
  if (!anchor) return null;

  if (anchor.getTime() > from.getTime()) return anchor;

  const elapsed = from.getTime() - anchor.getTime();
  const periods = Math.floor(elapsed / intervalMs) + 1;
  return new Date(anchor.getTime() + periods * intervalMs);
}

/**
 * Walks forward day by day in the schedule's zone until a day matches, then
 * takes the configured wall-clock time on that day.
 *
 * Day-at-a-time rather than arithmetic on instants because a "day" is not
 * 86,400,000 ms in a zone that observes DST — two days a year it is 23 or 25
 * hours, and adding fixed milliseconds walks off the intended calendar day.
 */
function nextByCalendar(
  rule: RecurrenceRule,
  notBefore: Date,
  from: Date,
  dayMatches: (_date: { year: number; month: number; day: number }) => boolean,
): Date | null {
  const hour = rule.hour ?? 0;
  const minute = rule.minute ?? 0;

  let date = dateOf(notBefore, rule.timezone);

  for (let step = 0; step < MAX_SEARCH_DAYS; step += 1) {
    if (dayMatches(date)) {
      const candidate = zonedTimeToUtc({ ...date, hour, minute }, rule.timezone);
      if (candidate > from && candidate >= notBefore) return candidate;
    }
    date = addCalendarDays(date, 1);
  }

  return null;
}

/**
 * MONTHLY, with the short-month rule.
 *
 * "Day 31 of every month" runs on 28, 29 or 30 February rather than skipping
 * February. Skipping is defensible for a birthday reminder and indefensible for
 * a security scan: the whole point is that the API is checked every month.
 */
function nextMonthly(rule: RecurrenceRule, notBefore: Date, from: Date): Date | null {
  const requestedDay = rule.monthDay ?? 1;
  if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) return null;

  const hour = rule.hour ?? 0;
  const minute = rule.minute ?? 0;
  const start = dateOf(notBefore, rule.timezone);

  let year = start.year;
  let month = start.month;

  // 48 months is far past any real case; it only bounds the loop.
  for (let step = 0; step < 48; step += 1) {
    const day = Math.min(requestedDay, daysInMonth(year, month));
    const candidate = zonedTimeToUtc({ year, month, day, hour, minute }, rule.timezone);
    if (candidate > from && candidate >= notBefore) return candidate;

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return null;
}

/** CUSTOM: the cron expression, evaluated against wall-clock time in the zone. */
function nextCron(rule: RecurrenceRule, notBefore: Date, from: Date): Date | null {
  if (!rule.cronExpression) return null;

  let fields: CronFields;
  try {
    fields = parseCron(rule.cronExpression);
  } catch {
    // An unparseable expression cannot be scheduled. Validation rejects one at
    // the API boundary; reaching here means a row predates a grammar change, and
    // "never runs again" is safer than guessing at intent.
    return null;
  }

  let date = dateOf(notBefore, rule.timezone);

  for (let step = 0; step < MAX_SEARCH_DAYS; step += 1) {
    if (cronMatchesDate(fields, { ...date, weekday: weekdayOf(date) })) {
      for (const hour of fields.hours) {
        for (const minute of fields.minutes) {
          const candidate = zonedTimeToUtc({ ...date, hour, minute }, rule.timezone);
          if (candidate > from && candidate >= notBefore) return candidate;
        }
      }
    }
    date = addCalendarDays(date, 1);
  }

  return null;
}

/** The calendar date an instant falls on, in the schedule's zone. */
function dateOf(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = zonedPartsOf(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * The next `count` occurrences. Used by the API to preview a rule before it is
 * saved, and by the safety check below.
 */
export function computeNextRuns(rule: RecurrenceRule, count: number, from: Date = new Date()): Date[] {
  const runs: Date[] = [];
  let cursor = from;

  for (let index = 0; index < count; index += 1) {
    const next = computeNextRun(rule, cursor);
    if (!next) break;
    runs.push(next);
    cursor = next;
  }

  return runs;
}

/**
 * The smallest gap the rule produces, in minutes, or null when it runs at most
 * once.
 *
 * Measured from the rule's own output rather than inferred from the expression,
 * so it cannot be fooled by a shape nobody anticipated: `0-59/5 * * * *` and
 * `0,5,10,15 * * * *` are caught by the same check.
 */
export function minimumGapMinutes(rule: RecurrenceRule, from: Date = new Date()): number | null {
  const runs = computeNextRuns(rule, 8, from);
  if (runs.length < 2) return null;

  let smallest = Infinity;
  for (let index = 1; index < runs.length; index += 1) {
    smallest = Math.min(smallest, runs[index].getTime() - runs[index - 1].getTime());
  }

  return Math.round(smallest / 60_000);
}

// ── Human descriptions ───────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `14:05` → `2:05 PM`. The product renders times to operators, not to machines. */
export function formatWallTime(hour: number, minute: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * A one-line description of the rule, in the operator's words.
 *
 * Computed on the server and returned with every schedule so the list, the
 * detail page and the create form all describe a rule identically — three
 * independent renderings of "every Monday and Wednesday at 2:00 AM" would
 * eventually disagree, and the one in the confirmation dialog is the one people
 * trust.
 */
export function describeRecurrence(rule: RecurrenceRule): string {
  const hour = rule.hour ?? 0;
  const minute = rule.minute ?? 0;
  const at = formatWallTime(hour, minute);

  switch (rule.frequency) {
    case 'ONCE':
      return rule.startAt
        ? `Once on ${formatCalendarDate(rule.startAt, rule.timezone)} at ${formatZonedClock(rule.startAt, rule.timezone)}`
        : 'Once';

    case 'HOURLY': {
      const interval = rule.intervalHours ?? 1;
      return interval === 1 ? 'Every hour' : `Every ${interval} hours`;
    }

    case 'DAILY':
      return `Every day at ${at}`;

    case 'WEEKLY': {
      const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[day]);
      if (days.length === 0) return `Weekly at ${at}`;
      if (days.length === 7) return `Every day at ${at}`;
      return `Every ${joinWithAnd(days)} at ${at}`;
    }

    case 'MONTHLY': {
      const day = rule.monthDay ?? 1;
      return `Day ${day} of every month at ${at}`;
    }

    case 'CUSTOM':
      return rule.cronExpression ? describeCron(rule.cronExpression) : 'Custom schedule';

    default:
      return 'Custom schedule';
  }
}

/**
 * Renders a cron expression as a sentence.
 *
 * Not a general cron-to-English engine — those are large and still produce
 * unreadable output for the awkward cases. This covers the shapes the advanced
 * field realistically receives and falls back to naming the expression itself,
 * which is honest, rather than to a confident wrong sentence.
 */
export function describeCron(expression: string): string {
  let fields: CronFields;
  try {
    fields = parseCron(expression);
  } catch {
    return `Custom schedule (${expression})`;
  }

  const everyMinute = fields.minutes.length === 60;
  const everyHour = fields.hours.length === 24;

  const timePart = (() => {
    if (everyMinute && everyHour) return 'Every minute';
    if (everyMinute) return `Every minute during ${joinWithAnd(fields.hours.map((h) => formatWallTime(h, 0)))}`;
    if (everyHour) {
      const step = uniformStep(fields.minutes, 60);
      if (step) return `Every ${step} minutes`;
      return `At ${joinWithAnd(fields.minutes.map((m) => `minute ${m}`))} of every hour`;
    }

    const step = uniformStep(fields.hours, 24);
    if (step && fields.minutes.length === 1) {
      return `Every ${step} hours at minute ${fields.minutes[0]}`;
    }

    const times = fields.hours.flatMap((h) => fields.minutes.map((m) => formatWallTime(h, m)));
    return times.length <= 4 ? `At ${joinWithAnd(times)}` : `At ${times.length} times a day`;
  })();

  const dayParts: string[] = [];
  if (fields.dowRestricted && fields.daysOfWeek.length < 7) {
    dayParts.push(`every ${joinWithAnd(fields.daysOfWeek.map((day) => WEEKDAY_NAMES[day]))}`);
  }
  if (fields.domRestricted) {
    dayParts.push(`on day ${joinWithAnd(fields.daysOfMonth.map(String))} of the month`);
  }
  if (fields.months.length !== 12) {
    dayParts.push(`in ${joinWithAnd(fields.months.map((month) => MONTH_NAMES[month - 1]))}`);
  }

  const dayPhrase = dayParts.length > 0 ? dayParts.join(', ') : 'every day';

  // "At 2:00 AM" + "every Monday" reads far better reversed, and reversing it
  // is what produces the sentence an operator recognises: the phrasing in the
  // advanced field's preview matches the phrasing the structured weekly option
  // produces for the same rule.
  if (timePart.startsWith('At ')) {
    const phrase = `${dayPhrase} at ${timePart.slice(3)}`;
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }

  return dayPhrase === 'every day' ? timePart : `${timePart} ${dayPhrase}`;
}

/** `[0, 15, 30, 45]` over a 60-wide range → 15. Null when the spacing varies. */
function uniformStep(values: number[], wrap: number): number | null {
  if (values.length < 2) return null;
  const step = values[1] - values[0];
  if (step <= 0) return null;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] - values[index - 1] !== step) return null;
  }
  // The wrap-around gap must match too, or the series is not actually uniform.
  if (values[0] + wrap - values[values.length - 1] !== step) return null;
  return step;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function formatCalendarDate(instant: Date, timeZone: string): string {
  const parts = zonedPartsOf(instant, timeZone);
  return `${MONTH_NAMES[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function formatZonedClock(instant: Date, timeZone: string): string {
  const parts = zonedPartsOf(instant, timeZone);
  return formatWallTime(parts.hour, parts.minute);
}
