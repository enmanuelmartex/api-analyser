import { describe, expect, it } from 'bun:test';
import { calendarDateIn, lastCompleteWeek, percentChange, previousWeek } from './week-range';

/**
 * Week boundaries and the week-over-week arithmetic.
 *
 * The two failure modes this file exists to prevent are both silent: a week
 * computed in the wrong zone reports the wrong days and nobody notices, and a
 * percentage computed against a zero baseline reaches an inbox reading
 * "Infinity%".
 */

/** UTC-4 all year, no DST — so a zone bug cannot hide behind a DST accident. */
const SANTO_DOMINGO = 'America/Santo_Domingo';
/** Observes DST, for the weeks that are not 168 hours long. */
const MADRID = 'Europe/Madrid';

describe('lastCompleteWeek', () => {
  it('reports the week that ended, not the one in progress', () => {
    // Monday 14 September 2026, 09:00 local.
    const week = lastCompleteWeek(new Date('2026-09-14T13:00:00Z'), SANTO_DOMINGO);

    expect(week.fromDate).toBe('2026-09-07');
    expect(week.toDate).toBe('2026-09-13');
  });

  it('gives the same answer every day of the week it is run', () => {
    // Monday through Sunday of the same week must all report the week before.
    const days = [
      '2026-09-14T13:00:00Z',
      '2026-09-15T13:00:00Z',
      '2026-09-17T13:00:00Z',
      '2026-09-20T23:00:00Z',
    ];

    for (const day of days) {
      const week = lastCompleteWeek(new Date(day), SANTO_DOMINGO);
      expect(week.fromDate, day).toBe('2026-09-07');
      expect(week.toDate, day).toBe('2026-09-13');
    }
  });

  /*
   * The catch-up guarantee, in one assertion.
   *
   * The scheduler's window stays open all week after an outage, and the
   * idempotency key is derived from `fromDate`. Both only work because the
   * answer above is stable across the whole week — if it drifted, a Wednesday
   * retry would send a second, different digest.
   */
  it('is stable enough to key an idempotency token on', () => {
    const monday = lastCompleteWeek(new Date('2026-09-14T13:00:00Z'), SANTO_DOMINGO);
    const thursday = lastCompleteWeek(new Date('2026-09-17T13:00:00Z'), SANTO_DOMINGO);
    expect(monday.fromDate).toBe(thursday.fromDate);
  });

  /*
   * The UTC off-by-one that this module exists to prevent.
   *
   * Monday 14 September, 02:00 UTC, is still Sunday 13 September at 22:00 in
   * Santo Domingo — so the week that just ended there is the one ending the
   * 6th, not the 13th. A naive implementation using UTC reports a week the user
   * is still living through.
   */
  it('uses the recipient zone rather than UTC at the boundary', () => {
    const instant = new Date('2026-09-14T02:00:00Z');

    expect(lastCompleteWeek(instant, 'UTC').toDate).toBe('2026-09-13');
    expect(lastCompleteWeek(instant, SANTO_DOMINGO).toDate).toBe('2026-09-06');
  });

  it('starts the week on Monday, not Sunday', () => {
    const week = lastCompleteWeek(new Date('2026-09-16T13:00:00Z'), SANTO_DOMINGO);
    // 7 September 2026 is a Monday; 13 September is a Sunday.
    expect(new Date(`${week.fromDate}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${week.toDate}T12:00:00Z`).getUTCDay()).toBe(0);
  });

  it('ends on the following Monday, exclusive', () => {
    const week = lastCompleteWeek(new Date('2026-09-14T13:00:00Z'), SANTO_DOMINGO);

    // Midnight local on the Monday after the reported Sunday. Exclusive, so a
    // scan finishing in the last millisecond of Sunday is still counted.
    expect(week.endExclusive.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(week.start.toISOString()).toBe('2026-09-07T04:00:00.000Z');
  });

  /*
   * A DST week is genuinely 169 hours long, and that is correct: the boundary
   * is what the user's clock read, not a fixed multiple of 24 hours. Computing
   * it as `start + 7 * 86400e3` would land an hour off and put an hour of
   * Sunday night into the following week.
   */
  it('spans a DST change by wall clock, not by a fixed 168 hours', () => {
    // Europe/Madrid moves its clock back on Sunday 25 October 2026.
    const week = lastCompleteWeek(new Date('2026-10-26T12:00:00Z'), MADRID);
    const hours = (week.endExclusive.getTime() - week.start.getTime()) / 3_600_000;

    expect(week.fromDate).toBe('2026-10-19');
    expect(week.toDate).toBe('2026-10-25');
    expect(hours).toBe(169);
  });

  it('handles a week spanning a month boundary', () => {
    const week = lastCompleteWeek(new Date('2026-09-07T13:00:00Z'), SANTO_DOMINGO);
    expect(week.fromDate).toBe('2026-08-31');
    expect(week.toDate).toBe('2026-09-06');
  });

  it('handles a week spanning a year boundary', () => {
    const week = lastCompleteWeek(new Date('2027-01-04T13:00:00Z'), SANTO_DOMINGO);
    expect(week.fromDate).toBe('2026-12-28');
    expect(week.toDate).toBe('2027-01-03');
  });
});

describe('previousWeek', () => {
  it('is the seven days immediately before, with no gap or overlap', () => {
    const week = lastCompleteWeek(new Date('2026-09-14T13:00:00Z'), SANTO_DOMINGO);
    const prior = previousWeek(week, SANTO_DOMINGO);

    expect(prior.fromDate).toBe('2026-08-31');
    expect(prior.toDate).toBe('2026-09-06');
    // Adjacency is what stops an assessment being counted in both weeks or in
    // neither, which would corrupt the percentage in either direction.
    expect(prior.endExclusive.getTime()).toBe(week.start.getTime());
  });
});

describe('percentChange', () => {
  it('computes an ordinary change', () => {
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(92, 100)).toBe(-8);
    expect(percentChange(100, 100)).toBe(0);
  });

  /*
   * The requirement from the brief, stated directly. Every naive spelling of
   * this produces something that reaches an inbox looking authoritative and
   * wrong: 0 → 5 gives Infinity, 0 → 0 gives NaN.
   */
  it('returns null rather than Infinity when the previous week was zero', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(1000, 0)).toBeNull();
  });

  it('returns null for a negative or nonsense baseline', () => {
    expect(percentChange(5, -3)).toBeNull();
    expect(percentChange(5, NaN)).toBeNull();
    expect(percentChange(NaN, 5)).toBeNull();
    expect(percentChange(5, Infinity)).toBeNull();
  });

  it('never returns a value the relay schema would reject', () => {
    // The schema accepts -100..100000 and finite only.
    for (const [current, previous] of [
      [0, 10],
      [1_000_000, 1],
      [3, 7],
      [7, 3],
    ]) {
      const result = percentChange(current, previous);
      expect(result).not.toBeNull();
      expect(Number.isFinite(result!)).toBe(true);
      expect(result!).toBeGreaterThanOrEqual(-100);
      expect(result!).toBeLessThanOrEqual(100_000);
      expect(Number.isInteger(result!)).toBe(true);
    }
  });

  it('floors at -100% when everything disappeared', () => {
    expect(percentChange(0, 40)).toBe(-100);
  });
});

describe('calendarDateIn', () => {
  it('resolves the date in the given zone, not in UTC', () => {
    const instant = new Date('2026-08-14T02:30:00Z');

    expect(calendarDateIn(instant, 'UTC')).toBe('2026-08-14');
    expect(calendarDateIn(instant, SANTO_DOMINGO)).toBe('2026-08-13');
    expect(calendarDateIn(instant, 'Asia/Tokyo')).toBe('2026-08-14');
  });

  it('always produces the shape the relay schema accepts', () => {
    expect(calendarDateIn(new Date('2026-01-05T00:00:00Z'), 'UTC')).toBe('2026-01-05');
    expect(calendarDateIn(new Date('2026-12-31T23:59:59Z'), 'UTC')).toBe('2026-12-31');
  });

  it('falls back to the UTC date rather than throwing on an unusable zone', () => {
    // A zone the tz database has since dropped should cost a day at most, not
    // an exception on the email path.
    expect(calendarDateIn(new Date('2026-08-14T02:30:00Z'), 'Not/AZone')).toBe('2026-08-14');
  });
});
