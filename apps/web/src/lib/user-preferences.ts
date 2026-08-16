/**
 * How this account wants dates and times rendered.
 *
 * Settings → General used to state the timezone and date format as *facts*:
 * whatever `Intl.DateTimeFormat().resolvedOptions()` reported, with the note
 * "not configurable in this build". That was honest but wrong for the job — an
 * operator reviewing a scan that ran overnight in another region has to read
 * every timestamp through their laptop's clock, and a report shared across a
 * team renders differently for each person reading it.
 *
 * This module is the machinery behind making it a real choice. It is
 * deliberately framework-free: a plain external store plus pure formatters, so
 * it can be unit-tested without React and so `lib/utils.ts` — imported by
 * server components for `cn` — can delegate to it without becoming a client
 * boundary. The React binding lives in `hooks/use-user-preferences.ts`.
 *
 * ── On the timezone
 *
 * `null` means "follow the browser", which is what the product did before and
 * what most people want. A stored zone is an IANA name (`America/Santo_Domingo`),
 * never a UTC offset: an offset cannot express "this zone observes DST", so a
 * timestamp rendered through one is silently an hour wrong for half the year.
 * That is the same reasoning `apps/api/.../recurrence/zoned-time.ts` documents
 * for scheduled scans, and the API validates a profile's zone with the same
 * helper.
 *
 * ── On the formats
 *
 * Stored as keys (`iso`), never as rendered patterns (`YYYY-MM-DD`) or as
 * `Intl` option bags. A key is a stable contract the API can validate against
 * a list (`apps/api/src/modules/auth/display-preferences.ts` holds the mirror
 * of these), and it leaves this module free to change what `iso` renders as
 * without a data migration. A key nothing here recognises degrades to the
 * default rather than throwing — an unrecognised preference should cost a
 * user their choice, not their page.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type DateFormatKey = 'auto' | 'medium' | 'long' | 'iso' | 'dmy' | 'mdy';

export type TimeFormatKey = 'auto' | '12h' | '24h';

export interface UserPreferences {
  /** An IANA zone name, or `null` to follow the browser. */
  timeZone: string | null;
  dateFormat: DateFormatKey;
  timeFormat: TimeFormatKey;
}

/**
 * What an account that has never chosen gets.
 *
 * `medium` + `12h` reproduce what every timestamp in the product rendered
 * before this existed — a hardcoded `en-US` short-month date — so nothing moves
 * for anyone until they deliberately move it.
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  timeZone: null,
  dateFormat: 'medium',
  timeFormat: '12h',
};

const DATE_FORMAT_KEYS: readonly DateFormatKey[] = ['auto', 'medium', 'long', 'iso', 'dmy', 'mdy'];
const TIME_FORMAT_KEYS: readonly TimeFormatKey[] = ['auto', '12h', '24h'];

/** The order the pickers list them in, with what each one is for. */
export const DATE_FORMAT_OPTIONS: { key: DateFormatKey; label: string; hint?: string }[] = [
  { key: 'auto', label: 'Match my device', hint: "Whatever your browser's language settings produce." },
  { key: 'medium', label: 'Month name, day, year' },
  { key: 'long', label: 'Day, full month name, year' },
  { key: 'iso', label: 'ISO 8601', hint: 'Year first. Sorts correctly as text and is unambiguous everywhere.' },
  { key: 'dmy', label: 'Day first' },
  { key: 'mdy', label: 'Month first' },
];

export const TIME_FORMAT_OPTIONS: { key: TimeFormatKey; label: string }[] = [
  { key: 'auto', label: 'Match my device' },
  { key: '12h', label: '12-hour' },
  { key: '24h', label: '24-hour' },
];

/**
 * Coerces anything the API or `localStorage` hands back into real preferences.
 *
 * Every field is checked independently: a row carrying a `dateFormat` this
 * build dropped still keeps its timezone. The timezone is checked against the
 * runtime, not by shape, for the same reason the API checks it — a zone the
 * platform cannot resolve makes `Intl` throw, and one bad column would take out
 * every timestamp on the page.
 */
export function normalisePreferences(raw: unknown): UserPreferences {
  const input = (raw ?? {}) as Record<string, unknown>;

  const timeZone = typeof input.timeZone === 'string' && isResolvableTimeZone(input.timeZone)
    ? input.timeZone
    : null;

  const dateFormat = DATE_FORMAT_KEYS.includes(input.dateFormat as DateFormatKey)
    ? (input.dateFormat as DateFormatKey)
    : DEFAULT_PREFERENCES.dateFormat;

  const timeFormat = TIME_FORMAT_KEYS.includes(input.timeFormat as TimeFormatKey)
    ? (input.timeFormat as TimeFormatKey)
    : DEFAULT_PREFERENCES.timeFormat;

  return { timeZone, dateFormat, timeFormat };
}

export function isResolvableTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own zone — the fallback when no zone has been chosen. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The zone a set of preferences actually renders in, with `null` resolved. */
export function effectiveTimeZone(preferences: UserPreferences = getPreferences()): string {
  return preferences.timeZone ?? detectTimeZone();
}

// ── The store ────────────────────────────────────────────────────────────────
//
// An external store rather than React context, so the formatters below can stay
// plain functions. Fifteen call sites across the app already say
// `formatDate(row.createdAt)`; rewriting every one of them into a hook to make
// a settings toggle work would be a large change with a large blast radius for
// no benefit those call sites can see.

const STORAGE_KEY = 'api_analyser_prefs';

let current: UserPreferences = DEFAULT_PREFERENCES;
let hydrated = false;
const listeners = new Set<() => void>();

/**
 * Reads the last known preferences out of `localStorage`, once.
 *
 * Purely to avoid a flash. The authoritative copy lives on the account and
 * arrives with `GET /auth/me`, but that is a round trip — without this, the
 * first paint after a reload renders every timestamp in the default format and
 * then visibly reformats them a moment later.
 *
 * Guarded on `window`, so a server render always sees the defaults. That is
 * safe here rather than a hydration hazard: nothing under `(dashboard)` is
 * server-rendered — `DashboardShell` holds a spinner until the session check
 * resolves on the client, and the chrome itself is a `ssr: false` dynamic
 * import — so no timestamp is ever part of the server HTML.
 */
function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) current = normalisePreferences(JSON.parse(stored));
  } catch {
    // Corrupt or unreadable storage is not worth failing a render over; the
    // account's real preferences land a moment later anyway.
  }
}

export function getPreferences(): UserPreferences {
  hydrate();
  return current;
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Replaces the active preferences and wakes every subscriber.
 *
 * Returns early when nothing differs, which is what makes it safe to call
 * during a render — `DashboardShell` does exactly that, because doing it in an
 * effect would mean the children paint once in the wrong format first.
 */
export function setPreferences(next: unknown): void {
  hydrate();
  const resolved = normalisePreferences(next);

  if (
    resolved.timeZone === current.timeZone &&
    resolved.dateFormat === current.dateFormat &&
    resolved.timeFormat === current.timeFormat
  ) {
    return;
  }

  current = resolved;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
    } catch {
      // Private browsing, quota, a disabled storage API — none of which should
      // stop the preference from applying for this session.
    }
  }

  for (const listener of listeners) listener();
}

/** Drops the cached copy at sign-out, so the next account starts clean. */
export function clearStoredPreferences(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing actionable.
    }
  }
  current = DEFAULT_PREFERENCES;
  hydrated = false;
  for (const listener of listeners) listener();
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * `Intl.DateTimeFormat` construction is the expensive part — the formatting
 * itself is cheap — and a table of two hundred rows builds the same formatter
 * once per cell. Keyed by zone and shape, both of which are drawn from a fixed
 * vocabulary, so this cannot grow without bound.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const built = build();
  formatterCache.set(key, built);
  return built;
}

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  /** 00–23. The 12-hour reading is derived from this, never re-formatted. */
  hour: number;
  minute: string;
  second: string;
}

/**
 * The wall-clock reading in `timeZone`, as strings, via `formatToParts`.
 *
 * Assembling the output from parts rather than leaning on a locale that happens
 * to produce the right order. `en-GB` renders `14/08/2026` today; that is a
 * property of CLDR data, not a guarantee, and "day first" has to mean day first
 * on every runtime and in every locale the browser is set to.
 */
function partsOf(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(`n|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
  ).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    // `h23` renders midnight as "24" on some runtimes rather than "00".
    hour: Number(lookup.hour) % 24,
    minute: lookup.minute,
    second: lookup.second,
  };
}

/**
 * The calendar day an instant falls on, in the account's zone, as `2026-08-14`.
 *
 * For "is this today?" comparisons. The obvious version — comparing
 * `getDate()`, `getMonth()` and `getFullYear()` against `new Date()` — asks the
 * question in the *browser's* zone, so an operator who has pinned their profile
 * to Tokyo gets a log table labelling this morning's events with yesterday's
 * date. Comparing keys built here asks it in the zone the timestamps are
 * actually being rendered in.
 */
export function zonedDayKey(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): string {
  const date = toDate(value);
  if (!date) return '';
  const { year, month, day } = partsOf(date, effectiveTimeZone(preferences));
  return `${year}-${month}-${day}`;
}

/** Whether two instants land on the same calendar day in the account's zone. */
export function isSameZonedDay(
  a: string | number | Date,
  b: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): boolean {
  const first = zonedDayKey(a, preferences);
  return first !== '' && first === zonedDayKey(b, preferences);
}

function monthName(date: Date, timeZone: string, width: 'short' | 'long'): string {
  return formatter(`m${width}|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-US', { timeZone, month: width }),
  ).format(date);
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The date alone, in the account's format and zone.
 *
 * An unparseable value renders as an em dash rather than "Invalid Date". These
 * are API timestamps: a null that slipped through a type is a bug worth seeing
 * in a table as a blank cell, not one worth turning into visible garbage.
 */
export function formatDay(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): string {
  const date = toDate(value);
  if (!date) return '—';

  const zone = effectiveTimeZone(preferences);

  if (preferences.dateFormat === 'auto') {
    return formatter(`auto|${zone}`, () =>
      new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium' }),
    ).format(date);
  }

  const { year, month, day } = partsOf(date, zone);

  switch (preferences.dateFormat) {
    case 'iso':
      return `${year}-${month}-${day}`;
    case 'dmy':
      return `${day}/${month}/${year}`;
    case 'mdy':
      return `${month}/${day}/${year}`;
    case 'long':
      return `${Number(day)} ${monthName(date, zone, 'long')} ${year}`;
    case 'medium':
    default:
      return `${monthName(date, zone, 'short')} ${Number(day)}, ${year}`;
  }
}

/**
 * The time of day alone, in the account's clock and zone.
 *
 * `seconds` is for the audit log, where the whole point of a timestamp is
 * correlating two events that happened within the same minute.
 */
export function formatTimeOfDay(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
  options: { seconds?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';

  const zone = effectiveTimeZone(preferences);
  const withSeconds = options.seconds === true;

  if (preferences.timeFormat === 'auto') {
    return formatter(`autot${withSeconds ? 's' : ''}|${zone}`, () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        ...(withSeconds ? { second: '2-digit' as const } : {}),
      }),
    ).format(date);
  }

  const { hour, minute, second } = partsOf(date, zone);
  const tail = withSeconds ? `${minute}:${second}` : minute;

  if (preferences.timeFormat === '24h') {
    return `${String(hour).padStart(2, '0')}:${tail}`;
  }

  /*
   * Derived arithmetically rather than by asking `Intl` for an h12 rendering.
   * Two reasons: the hour is already in hand from the parts above, and the
   * padding is then ours to decide — the old hardcoded formatter used
   * `hour: '2-digit'`, which in a 12-hour clock produces "03:04 PM". A leading
   * zero on a 12-hour clock is not a convention anything follows.
   */
  return `${hour % 12 === 0 ? 12 : hour % 12}:${tail} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Date and time together — the shape most of the product renders. */
export function formatDateTime(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDay(date, preferences)}, ${formatTimeOfDay(date, preferences)}`;
}

/**
 * Recent instants as an interval, older ones as a date.
 *
 * "12m ago" answers "is this happening now?" — the question a scan list is
 * being scanned for — and needs no zone at all, which is why the preference
 * only takes effect once the answer stops being interesting.
 */
export function formatRelative(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): string {
  const date = toDate(value);
  if (!date) return '—';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDateTime(date, preferences);
}

/**
 * Recent activity as a plain word, older activity as a date.
 *
 * The variant the user directory wants: "is this account in use?" is answered
 * better by "Yesterday" than by an interval in hours.
 */
export function formatRelativeDay(
  value: string | number | Date,
  preferences: UserPreferences = getPreferences(),
): string {
  const date = toDate(value);
  if (!date) return '—';

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return formatDay(date, preferences);
}

/**
 * A fixed instant for the format pickers to render.
 *
 * Deliberately unambiguous: the 14th of a month whose name is short, at an hour
 * past noon. A sample dated the 3rd at 09:00 reads identically under "day
 * first" and "month first", which is exactly what the picker exists to let
 * someone tell apart.
 */
export const SAMPLE_INSTANT = new Date('2026-08-14T19:04:00.000Z');
