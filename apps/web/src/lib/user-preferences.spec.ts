import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_PREFERENCES,
  formatDateTime,
  formatDay,
  formatRelative,
  formatRelativeDay,
  formatTimeOfDay,
  isResolvableTimeZone,
  normalisePreferences,
  type UserPreferences,
} from './user-preferences';

/**
 * The instant every case below is anchored to.
 *
 * 2026-08-14T19:04Z is 15:04 in New York and 09:04 the *same* day in Honolulu,
 * but 04:04 on the 15th in Tokyo — so a zone that is being ignored shows up as
 * a wrong date, not merely a wrong hour, which is a far easier failure to read.
 */
const INSTANT = new Date('2026-08-14T19:04:00.000Z');

function prefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return { ...DEFAULT_PREFERENCES, timeZone: 'America/New_York', ...overrides };
}

describe('normalisePreferences', () => {
  it('falls back to the defaults for an empty record', () => {
    expect(normalisePreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect(normalisePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('reads the columns straight off a user record', () => {
    expect(
      normalisePreferences({
        id: 'u1',
        name: 'Ana',
        timeZone: 'Europe/Madrid',
        dateFormat: 'iso',
        timeFormat: '24h',
      }),
    ).toEqual({ timeZone: 'Europe/Madrid', dateFormat: 'iso', timeFormat: '24h' });
  });

  /*
   * The rule that keeps a dropped option from costing more than itself. An
   * account holding a key this build no longer ships should lose that one
   * choice, not have its whole profile reset.
   */
  it('rejects each unknown value independently', () => {
    expect(
      normalisePreferences({ timeZone: 'Europe/Madrid', dateFormat: 'klingon', timeFormat: '24h' }),
    ).toEqual({ timeZone: 'Europe/Madrid', dateFormat: 'medium', timeFormat: '24h' });
  });

  it('drops a timezone the runtime cannot resolve rather than throwing later', () => {
    // The shapes a naive `@IsString()` would have let through, each of which
    // makes `Intl.DateTimeFormat` throw and would take out every timestamp on
    // the page rather than just this one setting.
    for (const bad of ['UTC-4', 'Not/AZone', '', 'America/Santo Domingo']) {
      expect(normalisePreferences({ timeZone: bad }).timeZone).toBeNull();
    }
    expect(isResolvableTimeZone('America/Santo_Domingo')).toBe(true);
  });

  /*
   * `EST` is a real tz database entry, not a typo — a legacy fixed-offset zone
   * that never observes DST. It is accepted here for exactly one reason: the
   * scheduler's `isValidTimeZone` accepts it too, and a zone a scheduled scan
   * can run in must be a zone a profile can display in. Someone who picks it
   * gets a clock that is an hour off for half the year, which is the zone's own
   * documented meaning rather than a bug in this code — and the picker offers
   * `America/New_York` right beside it.
   */
  it('accepts the legacy fixed-offset zones the scheduler also accepts', () => {
    expect(normalisePreferences({ timeZone: 'EST' }).timeZone).toBe('EST');
  });
});

describe('formatDay', () => {
  it('renders each format in the account timezone', () => {
    expect(formatDay(INSTANT, prefs({ dateFormat: 'medium' }))).toBe('Aug 14, 2026');
    expect(formatDay(INSTANT, prefs({ dateFormat: 'long' }))).toBe('14 August 2026');
    expect(formatDay(INSTANT, prefs({ dateFormat: 'iso' }))).toBe('2026-08-14');
    expect(formatDay(INSTANT, prefs({ dateFormat: 'dmy' }))).toBe('14/08/2026');
    expect(formatDay(INSTANT, prefs({ dateFormat: 'mdy' }))).toBe('08/14/2026');
  });

  /*
   * The reason the timezone is a setting at all. The same instant is a
   * different *calendar day* east of the dateline-adjacent zones, and an
   * operator in Tokyo reading "Aug 14" for a scan that ran on the 15th their
   * time has been told the wrong thing.
   */
  it('rolls the date over when the zone does', () => {
    expect(formatDay(INSTANT, prefs({ timeZone: 'Asia/Tokyo', dateFormat: 'iso' }))).toBe(
      '2026-08-15',
    );
    expect(formatDay(INSTANT, prefs({ timeZone: 'Pacific/Honolulu', dateFormat: 'iso' }))).toBe(
      '2026-08-14',
    );
  });

  it('renders day-first and month-first differently for the same instant', () => {
    const dmy = formatDay(INSTANT, prefs({ dateFormat: 'dmy' }));
    const mdy = formatDay(INSTANT, prefs({ dateFormat: 'mdy' }));
    expect(dmy).not.toBe(mdy);
  });
});

describe('formatTimeOfDay', () => {
  it('renders a 24-hour clock zero-padded', () => {
    expect(formatTimeOfDay(INSTANT, prefs({ timeFormat: '24h' }))).toBe('15:04');
  });

  it('renders a 12-hour clock without a leading zero', () => {
    expect(formatTimeOfDay(INSTANT, prefs({ timeFormat: '12h' }))).toBe('3:04 PM');
  });

  /* Midnight and noon are where a `% 12` gets written wrong. */
  it('renders midnight as 12 AM and noon as 12 PM', () => {
    const midnight = new Date('2026-08-14T04:00:00.000Z'); // 00:00 in New York
    const noon = new Date('2026-08-14T16:00:00.000Z'); // 12:00 in New York

    expect(formatTimeOfDay(midnight, prefs({ timeFormat: '12h' }))).toBe('12:00 AM');
    expect(formatTimeOfDay(noon, prefs({ timeFormat: '12h' }))).toBe('12:00 PM');
    expect(formatTimeOfDay(midnight, prefs({ timeFormat: '24h' }))).toBe('00:00');
  });

  it('respects the zone, not the host clock', () => {
    expect(formatTimeOfDay(INSTANT, prefs({ timeZone: 'UTC', timeFormat: '24h' }))).toBe('19:04');
    expect(formatTimeOfDay(INSTANT, prefs({ timeZone: 'Asia/Tokyo', timeFormat: '24h' }))).toBe(
      '04:04',
    );
  });
});

describe('formatDateTime', () => {
  it('reproduces the old hardcoded rendering under the default preferences', () => {
    // What every timestamp in the product looked like before this was
    // configurable, minus the leading zero the 12-hour clock never wanted.
    expect(formatDateTime(INSTANT, prefs())).toBe('Aug 14, 2026, 3:04 PM');
  });

  it('returns an em dash for an unparseable value instead of "Invalid Date"', () => {
    expect(formatDateTime('not a date', prefs())).toBe('—');
    expect(formatDay(Number.NaN, prefs())).toBe('—');
  });
});

describe('formatRelative', () => {
  it('describes recent instants as an interval, without needing a zone', () => {
    expect(formatRelative(new Date(Date.now() - 30_000), prefs())).toBe('just now');
    expect(formatRelative(new Date(Date.now() - 15 * 60_000), prefs())).toBe('15m ago');
    expect(formatRelative(new Date(Date.now() - 5 * 3_600_000), prefs())).toBe('5h ago');
    expect(formatRelative(new Date(Date.now() - 3 * 86_400_000), prefs())).toBe('3d ago');
  });

  it('falls back to a formatted timestamp past a week', () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    expect(formatRelative(old, prefs({ dateFormat: 'iso', timeFormat: '24h' }))).toBe(
      formatDateTime(old, prefs({ dateFormat: 'iso', timeFormat: '24h' })),
    );
  });
});

describe('formatRelativeDay', () => {
  it('names the last two days rather than counting hours', () => {
    expect(formatRelativeDay(new Date(Date.now() - 3_600_000), prefs())).toBe('Today');
    expect(formatRelativeDay(new Date(Date.now() - 30 * 3_600_000), prefs())).toBe('Yesterday');
    expect(formatRelativeDay(new Date(Date.now() - 4 * 86_400_000), prefs())).toBe('4d ago');
  });

  it('uses the account date format once the interval stops being useful', () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    expect(formatRelativeDay(old, prefs({ dateFormat: 'iso' }))).toBe(
      formatDay(old, prefs({ dateFormat: 'iso' })),
    );
  });
});
