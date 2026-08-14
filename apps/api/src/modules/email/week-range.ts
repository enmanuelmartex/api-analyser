import {
  addCalendarDays,
  zonedPartsOf,
  zonedTimeToUtc,
} from '../scheduled-scans/recurrence/zoned-time';

/**
 * Week boundaries and week-over-week arithmetic for the weekly digest.
 *
 * ── Why this is not five lines of `Date` maths ───────────────────────────────
 *
 * "Last week" is a wall-clock idea. A user in `America/Santo_Domingo` means
 * Monday 00:00 *there*, which is Monday 04:00 UTC — so a naive
 * `new Date().setDate(date.getDate() - 7)` computed on a server running in UTC
 * reports a week that is four hours out at both ends. Scans that ran on Sunday
 * evening land in the wrong week, and the two weeks being compared overlap.
 *
 * The same problem, and the same solution, as scheduled scans: the recurrence
 * engine already converts between instants and wall time using the platform's
 * tz database, and this reuses it rather than growing a second implementation
 * that could disagree with it about a DST boundary.
 *
 * A DST week is genuinely 167 or 169 hours long, and that is correct: the
 * boundaries are what the user's clock read, not a fixed multiple of 24 hours.
 */

export interface WeekRange {
  /** Inclusive start — Monday 00:00:00.000 in the zone, as an instant. */
  readonly start: Date;
  /**
   * EXCLUSIVE end — the following Monday 00:00:00.000, as an instant.
   *
   * Exclusive rather than "Sunday 23:59:59.999" so that a scan finishing in the
   * last millisecond of the week is counted. A closed upper bound has to pick a
   * precision, and every choice of precision silently drops whatever falls in
   * the gap; `lt` has no gap.
   */
  readonly endExclusive: Date;
  /** First day, `YYYY-MM-DD` in the zone. What the email prints. */
  readonly fromDate: string;
  /** Last day INCLUSIVE, `YYYY-MM-DD` — the Sunday, not the next Monday. */
  readonly toDate: string;
}

/**
 * The most recently completed Monday-to-Sunday week in `timeZone`, relative to
 * `now`.
 *
 * "Completed" is the important word. Run on Monday morning, this returns the
 * week that ended the previous night, never the one currently in progress —
 * a digest of a week that is one hour old would report almost nothing and would
 * make the following week's numbers wrong too.
 */
export function lastCompleteWeek(now: Date, timeZone: string): WeekRange {
  const today = zonedPartsOf(now, timeZone);

  // `weekday` is 0=Sunday. Days since the most recent Monday, where Sunday is
  // six days after Monday rather than one day before it.
  const daysSinceMonday = (today.weekday + 6) % 7;

  const thisMonday = { year: today.year, month: today.month, day: today.day };
  const lastMonday = addCalendarDays(thisMonday, -(daysSinceMonday + 7));
  const lastSunday = addCalendarDays(lastMonday, 6);
  const nextMonday = addCalendarDays(lastMonday, 7);

  return {
    start: zonedTimeToUtc({ ...lastMonday, hour: 0, minute: 0 }, timeZone),
    endExclusive: zonedTimeToUtc({ ...nextMonday, hour: 0, minute: 0 }, timeZone),
    fromDate: toIsoDate(lastMonday),
    toDate: toIsoDate(lastSunday),
  };
}

/** The seven days immediately before `week`, for the comparison. */
export function previousWeek(week: WeekRange, timeZone: string): WeekRange {
  const start = zonedPartsOf(week.start, timeZone);
  const monday = { year: start.year, month: start.month, day: start.day };
  const previousMonday = addCalendarDays(monday, -7);
  const previousSunday = addCalendarDays(previousMonday, 6);

  return {
    start: zonedTimeToUtc({ ...previousMonday, hour: 0, minute: 0 }, timeZone),
    // Ends exactly where the reported week begins, so the two are adjacent and
    // cannot overlap or leave a gap between them.
    endExclusive: week.start,
    fromDate: toIsoDate(previousMonday),
    toDate: toIsoDate(previousSunday),
  };
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** `YYYY-MM-DD`, which is what the mail service's schema accepts. */
function toIsoDate({ year, month, day }: CalendarDay): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The calendar date an instant falls on, in a given zone, as `YYYY-MM-DD`.
 *
 * What the emails send instead of a timestamp. A scan that finished at 21:40 on
 * 13 August in Santo Domingo is `2026-08-13` here and `2026-08-14` in UTC, and
 * the reader who ran it means the former. Resolving the date on this side means
 * the mail service formats a date that is already correct rather than
 * converting one and having to be told which zone to convert into.
 *
 * Falls back to the UTC date if the zone is unusable — a zone name that the
 * runtime's tz database has since dropped should produce a date that is at most
 * a day out, not an exception on the email path.
 */
export function calendarDateIn(instant: Date, timeZone: string): string {
  try {
    const parts = zonedPartsOf(instant, timeZone);
    return toIsoDate({ year: parts.year, month: parts.month, day: parts.day });
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * Week-over-week change, as a percentage, or null when there is nothing to
 * compare against.
 *
 * ── The null is the whole point ─────────────────────────────────────────────
 *
 * `(current - previous) / previous` is undefined when `previous` is 0, and
 * every naive spelling of it produces something that reaches an inbox looking
 * authoritative and wrong:
 *
 *   0 → 5   gives `Infinity`, rendered as "Infinity%"
 *   0 → 0   gives `NaN`, rendered as "NaN%"
 *
 * Returning null instead says "no baseline", which the email renders as no
 * comparison line at all. A user's first week genuinely has nothing to compare
 * against, and saying so is more honest than inventing "+∞%" or "0%" — the
 * latter would claim nothing changed when in fact everything did.
 *
 * The result is clamped to the range the mail service accepts, so a pathological
 * ratio is capped rather than rejected at the boundary.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return null;

  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return null;

  // The schema accepts -100..100000; a rounded value is what gets rendered, so
  // clamping here keeps a 500x week from being a 400 rather than a big number.
  return Math.max(-100, Math.min(100_000, Math.round(change)));
}
