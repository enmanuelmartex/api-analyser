import { describe, expect, it } from 'bun:test';
import { CronParseError, cronMatchesDate, parseCron } from './cron';

/**
 * The cron field is the only place an operator can hand this product a
 * scheduling rule as free text, so its parser is a trust boundary. Everything
 * it accepts becomes a plan to send traffic at somebody's API; everything it
 * misreads becomes a scan at the wrong time.
 */

describe('parseCron — grammar', () => {
  it('expands every supported form', () => {
    expect(parseCron('0 2 * * 1').minutes).toEqual([0]);
    expect(parseCron('0 2 * * 1').hours).toEqual([2]);
    expect(parseCron('0,30 * * * *').minutes).toEqual([0, 30]);
    expect(parseCron('0 9-17 * * *').hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseCron('*/20 * * * *').minutes).toEqual([0, 20, 40]);
    expect(parseCron('0 0-12/6 * * *').hours).toEqual([0, 6, 12]);
  });

  it('treats a bare value with a step as "from here onwards"', () => {
    // `5/15` is "every 15 minutes starting at 5", which is how every cron
    // implementation reads it.
    expect(parseCron('5/15 * * * *').minutes).toEqual([5, 20, 35, 50]);
  });

  it('normalises Sunday, which cron spells both 0 and 7', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 0,7').daysOfWeek).toEqual([0]);
  });

  it('records which day fields are restricted, because the match rule depends on it', () => {
    const both = parseCron('0 0 1 * 1');
    expect(both.domRestricted).toBe(true);
    expect(both.dowRestricted).toBe(true);

    const neither = parseCron('0 0 * * *');
    expect(neither.domRestricted).toBe(false);
    expect(neither.dowRestricted).toBe(false);
  });
});

describe('parseCron — rejections', () => {
  const rejected: [string, string][] = [
    ['', 'empty'],
    ['0 2 * *', 'four fields'],
    ['0 2 * * 1 6', 'six fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 0 * *', 'day of month below 1'],
    ['* * 32 * *', 'day of month above 31'],
    ['* * * 13 *', 'month out of range'],
    ['* * * * 8', 'day of week out of range'],
    ['10-5 * * * *', 'descending range'],
    ['*/0 * * * *', 'zero step'],
    ['*/-1 * * * *', 'negative step'],
    ['0 2 * * MON', 'named day'],
    ['@daily', 'nickname'],
    ['0 0 L * *', 'vendor extension'],
    ['0 0 * * 1#2', 'nth-weekday extension'],
    ['0,,5 * * * *', 'empty list element'],
  ];

  for (const [expression, why] of rejected) {
    it(`rejects ${why}: "${expression}"`, () => {
      expect(() => parseCron(expression)).toThrow(CronParseError);
    });
  }

  it('rejects an expression long enough to be an attack rather than a schedule', () => {
    expect(() => parseCron(`${'1,'.repeat(200)}1 * * * *`)).toThrow(CronParseError);
  });

  it('names the offending field, so the error is actionable', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/minute/);
    expect(() => parseCron('* * * 13 *')).toThrow(/month/);
  });
});

describe('cronMatchesDate', () => {
  // 1 August 2026 is a Saturday (weekday 6); 3 August is a Monday.
  const saturday = { month: 8, day: 1, weekday: 6 };
  const monday = { month: 8, day: 3, weekday: 1 };

  it('matches every day when neither day field is restricted', () => {
    const fields = parseCron('0 0 * * *');
    expect(cronMatchesDate(fields, saturday)).toBe(true);
    expect(cronMatchesDate(fields, monday)).toBe(true);
  });

  it('uses day-of-week alone when only it is restricted', () => {
    const fields = parseCron('0 0 * * 1');
    expect(cronMatchesDate(fields, saturday)).toBe(false);
    expect(cronMatchesDate(fields, monday)).toBe(true);
  });

  it('uses day-of-month alone when only it is restricted', () => {
    const fields = parseCron('0 0 1 * *');
    expect(cronMatchesDate(fields, saturday)).toBe(true); // the 1st
    expect(cronMatchesDate(fields, monday)).toBe(false); // the 3rd
  });

  it('unions the two when both are restricted — the historical Vixie rule', () => {
    // The rule that surprises people: `0 0 1 * 1` is "the 1st OR any Monday",
    // not "the 1st, but only if it is a Monday".
    const fields = parseCron('0 0 1 * 1');
    expect(cronMatchesDate(fields, saturday)).toBe(true); // the 1st
    expect(cronMatchesDate(fields, monday)).toBe(true); // a Monday
    expect(cronMatchesDate(fields, { month: 8, day: 4, weekday: 2 })).toBe(false);
  });

  it('respects the month field before anything else', () => {
    const fields = parseCron('0 0 * 9 *');
    expect(cronMatchesDate(fields, saturday)).toBe(false);
    expect(cronMatchesDate(fields, { month: 9, day: 1, weekday: 2 })).toBe(true);
  });
});
