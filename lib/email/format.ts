/**
 * Turning validated values into the strings a reader sees.
 *
 * ── Why dates arrive as `YYYY-MM-DD` and not as timestamps ──────────────────
 *
 * A scan that finished at 21:40 on 13 August in Santo Domingo happened at
 * 01:40 on 14 August in UTC. Send an instant and format it here, and the email
 * confidently reports the wrong day to the person who ran the scan — the
 * classic off-by-one that only shows up for users west of Greenwich, in the
 * evening, which is to say in production and never in a test.
 *
 * The fix is to not carry a timezone across the boundary at all. The API knows
 * the user's zone, resolves the calendar date in it, and sends the result: a
 * plain date with no time and no offset. This service formats it as written.
 * There is no conversion here, so there is nothing to get wrong.
 */

/**
 * Month names, written out rather than obtained from `Intl.DateTimeFormat`.
 *
 * A formatter would need a locale and a timezone, and supplying a timezone is
 * the mistake this module exists to avoid. Twelve constants have no such
 * failure mode.
 */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A calendar date with no time and no zone, as `YYYY-MM-DD`. */
export interface CalendarDate {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
}

/**
 * Parses `YYYY-MM-DD`.
 *
 * Deliberately not `new Date(value)`: that parses a bare date string as
 * midnight UTC and then renders it in the runtime's local zone, reintroducing
 * exactly the off-by-one this format exists to avoid. Splitting on the hyphens
 * keeps the three numbers as numbers.
 *
 * The schema has already checked the shape and that the date is real, so this
 * cannot fail for a validated payload.
 */
export function parseCalendarDate(value: string): CalendarDate {
  const parts = value.split('-');
  return {
    year: Number(parts[0]),
    month: Number(parts[1]),
    day: Number(parts[2]),
  };
}

/** `August 13, 2026`. */
export function formatDate(value: string): string {
  const { year, month, day } = parseCalendarDate(value);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/**
 * A date range, collapsed as far as the two ends allow.
 *
 *   same month  →  `August 7 – 13, 2026`
 *   same year   →  `August 28 – September 3, 2026`
 *   neither     →  `December 30, 2025 – January 5, 2026`
 *
 * An en dash rather than a hyphen: it is the correct character for a range, it
 * is plain Latin-1, and the document is UTF-8, so no client has to guess.
 */
export function formatDateRange(from: string, to: string): string {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);

  const startMonth = MONTH_NAMES[start.month - 1];
  const endMonth = MONTH_NAMES[end.month - 1];

  if (start.year !== end.year) {
    return `${startMonth} ${start.day}, ${start.year} – ${endMonth} ${end.day}, ${end.year}`;
  }

  if (start.month !== end.month) {
    return `${startMonth} ${start.day} – ${endMonth} ${end.day}, ${end.year}`;
  }

  return `${startMonth} ${start.day} – ${end.day}, ${end.year}`;
}

/**
 * A count, with thousands separators.
 *
 * `en-US` is pinned rather than left to the runtime's locale. A Vercel function
 * has no user locale, so the alternative is whatever the container defaults to
 * — which means the same number could render as `1,204` or `1.204` depending on
 * the region a build happened to be deployed in.
 */
export function formatCount(value: number): string {
  return Math.max(Math.trunc(value), 0).toLocaleString('en-US');
}

/** `37 / 100`, or `—` for a scan whose score could not be computed. */
export function formatScore(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} / 100`;
}

/**
 * A week-over-week delta, as `+12%`, `-8%` or `0%`.
 *
 * `null` in, `null` out: the API sends null when the previous week had nothing
 * to compare against, because a percentage change from zero has no meaning —
 * and computing one anyway is how `Infinity%` reaches an inbox.
 */
export function formatPercent(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const rounded = Math.round(value);
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

/**
 * The colour a delta is printed in.
 *
 * `higherIsBetter` is the whole point. Assessments run is a productivity
 * measure where up is progress; findings and criticals are defect counts where
 * up is a regression. Both are the same arithmetic, and colouring them the same
 * way would congratulate a reader on a week their critical findings tripled.
 */
export function toneFor(
  value: number | null | undefined,
  higherIsBetter: boolean,
): 'positive' | 'negative' | 'neutral' {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.round(value) === 0) {
    return 'neutral';
  }
  const improved = value > 0 === higherIsBetter;
  return improved ? 'positive' : 'negative';
}

/** `1 finding` / `2 findings`. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const safe = Math.max(Math.trunc(count), 0);
  return safe === 1 ? singular : (pluralForm ?? `${singular}s`);
}
