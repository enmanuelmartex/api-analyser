/**
 * Wall-clock arithmetic in a named IANA timezone.
 *
 * Built on `Intl.DateTimeFormat`, which is backed by the platform's own tz
 * database, rather than on a date library. Two reasons:
 *
 *  - No new dependency. The API deliberately has no scheduling or date library,
 *    and a scheduler is not a good reason to add one that then has to be kept
 *    in step with the tz database independently of the runtime.
 *  - The tz database is the runtime's. When a government moves a DST boundary,
 *    a Node/Bun upgrade fixes every schedule; a bundled rules table would not.
 *
 * Everything here converts between two representations and nothing else:
 *
 *    instant   — an absolute point in time (`Date`, i.e. UTC ms). What we store.
 *    wall time — what a clock on the wall in that zone reads. What a user means
 *                by "02:00", and what must survive a DST change unchanged.
 *
 * The whole point of the distinction: "every day at 02:00 America/Santo_Domingo"
 * is a wall-time rule. Storing it as a fixed UTC offset would silently drift by
 * an hour twice a year in any zone that observes DST.
 */

/** A wall-clock reading in some zone. `month` is 1-12; `weekday` is 0=Sunday. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/** The wall-clock fields a recurrence rule specifies. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Formatters are expensive to construct and are pure for a given zone, so they
 * are built once. The scheduler formats several times per schedule per tick.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * Is this a timezone the runtime actually knows?
 *
 * The only correct validation: `Intl` throws `RangeError` for an unknown zone,
 * and a hand-maintained allow-list would drift from the tz database. Rejecting
 * here is what stops a schedule being stored with a name that can never be
 * resolved, which would leave it permanently unrunnable.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at an absolute instant. */
export function zonedPartsOf(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // `hourCycle: 'h23'` still renders midnight as "24" in some ICU versions.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday] ?? 0,
  };
}

/** Milliseconds a wall-clock reading is ahead of UTC, treated as if it were UTC. */
function wallAsUtcMs(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
}

/**
 * The zone's UTC offset in milliseconds, at one instant.
 *
 * Derived by rendering the instant in the zone and asking how far that reading
 * is from the same reading interpreted as UTC. Correct across DST because it is
 * evaluated at a specific instant rather than for the zone as a whole.
 */
export function offsetMsOf(instant: Date, timeZone: string): number {
  const parts = zonedPartsOf(instant, timeZone);
  // Milliseconds are dropped on both sides so they cancel exactly.
  const truncated = instant.getTime() - instant.getMilliseconds();
  return wallAsUtcMs(parts) - truncated;
}

/**
 * The instant at which the clocks in `timeZone` read `wall`.
 *
 * Two DST edge cases, both resolved deliberately:
 *
 *  - AMBIGUOUS (autumn, the hour repeats). The EARLIER of the two instants is
 *    returned. A daily scan then runs 23 hours after the previous one rather
 *    than 25, which is the lesser surprise, and it is the same convention the
 *    ECMAScript spec uses for local-time parsing.
 *
 *  - NONEXISTENT (spring, the hour is skipped). There is no instant that reads
 *    02:30, so the run is shifted forward by the width of the gap and happens at
 *    03:30 — it runs once, on the right day, as close as the calendar allows.
 *    The alternative, skipping the day entirely, silently drops a security scan.
 */
export function zonedTimeToUtc(wall: WallTime, timeZone: string): Date {
  const asUtc = wallAsUtcMs(wall);

  // First guess: the offset in force at the same numeric instant read as UTC.
  // Wrong by at most the offset itself, which is why it is refined below.
  const guessOffset = offsetMsOf(new Date(asUtc), timeZone);
  const firstPass = new Date(asUtc - guessOffset);

  const settledOffset = offsetMsOf(firstPass, timeZone);
  if (settledOffset === guessOffset) return firstPass;

  const secondPass = new Date(asUtc - settledOffset);
  if (readsAs(secondPass, wall, timeZone)) return secondPass;
  if (readsAs(firstPass, wall, timeZone)) return firstPass;

  // Neither renders as the requested wall time: it does not exist in this zone.
  // `firstPass` was computed with the pre-transition offset, so it lands after
  // the gap, displaced by exactly the gap's width.
  return firstPass;
}

/** Does the zone's clock read exactly `wall` at this instant? */
function readsAs(instant: Date, wall: WallTime, timeZone: string): boolean {
  const parts = zonedPartsOf(instant, timeZone);
  return (
    parts.year === wall.year &&
    parts.month === wall.month &&
    parts.day === wall.day &&
    parts.hour === wall.hour &&
    parts.minute === wall.minute
  );
}

/**
 * The zone's offset as an operator reads it, e.g. `UTC-4`, `UTC+5:30`.
 *
 * Evaluated at an instant, never for the zone in the abstract: the same zone is
 * `UTC-5` and `UTC-4` at different times of year, and a UI that shows the wrong
 * one at the wrong time of year is worse than showing none.
 */
export function formatUtcOffset(timeZone: string, at: Date = new Date()): string {
  const totalMinutes = Math.round(offsetMsOf(at, timeZone) / 60_000);
  if (totalMinutes === 0) return 'UTC';

  const sign = totalMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

/** Calendar-day arithmetic on a date triple. Never touches any timezone. */
export function addCalendarDays(
  date: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Day of the week (0=Sunday) of a calendar date, independent of any zone. */
export function weekdayOf(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Length of a calendar month, so "day 31" can be clamped to a short month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * IANA zones the runtime supports, each with its offset right now.
 *
 * Read from the runtime rather than hardcoded, for the same reason validation
 * is: the list is whatever the platform's tz database contains. A runtime
 * without `supportedValuesOf` falls back to a small set covering the product's
 * likely deployments, so the picker is never empty.
 */
export function listTimeZones(at: Date = new Date()): { id: string; offset: string; label: string }[] {
  const ids =
    typeof (Intl as any).supportedValuesOf === 'function'
      ? ((Intl as any).supportedValuesOf('timeZone') as string[])
      : FALLBACK_TIME_ZONES;

  return ids
    .filter((id) => isValidTimeZone(id))
    .map((id) => {
      const offset = formatUtcOffset(id, at);
      return { id, offset, label: `${id.replace(/_/g, ' ')} (${offset})` };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/Santo_Domingo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'America/Bogota',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];
