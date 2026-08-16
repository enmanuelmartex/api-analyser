import { beforeAll, describe, expect, it } from 'bun:test';
import {
  DEFAULT_NOTIFICATION_FILTERS,
  groupByDay,
  parseNotificationFilters,
  serializeNotificationFilters,
  sinceFor,
} from './notification-list';
import { setPreferences } from './user-preferences';
import type { AppNotification } from '@/types';

/**
 * The period filter and the day grouping behind the notifications screen.
 *
 * Both are pure, and both are the sort of thing that looks obviously right and
 * is off by a timezone: the window has to be measured from *now* rather than
 * from midnight, and a day boundary has to be the account's, not the machine's.
 */

// Pinned so the grouping assertions mean the same thing on a laptop in Santo
// Domingo and in CI, which runs in UTC.
beforeAll(() => {
  setPreferences({ timeZone: 'America/Santo_Domingo', dateFormat: 'iso', timeFormat: '24h' });
});

const NOW = new Date('2026-08-15T15:00:00Z');

describe('sinceFor', () => {
  it('measures the window back from now, not from midnight', () => {
    // 09:00 local yesterday, not 00:00 today — the whole point of the filter is
    // that "the last 24 hours" is the same length whenever it is applied.
    expect(sinceFor('24h', NOW)).toBe('2026-08-14T15:00:00.000Z');
  });

  it('covers the longer windows in whole days', () => {
    expect(sinceFor('7d', NOW)).toBe('2026-08-08T15:00:00.000Z');
    expect(sinceFor('30d', NOW)).toBe('2026-07-16T15:00:00.000Z');
    expect(sinceFor('90d', NOW)).toBe('2026-05-17T15:00:00.000Z');
  });

  it('sends no floor at all for the whole history', () => {
    // Not an early date: an absent `since` is what the API reads as unfiltered.
    expect(sinceFor('all', NOW)).toBeUndefined();
  });
});

describe('filter round trip', () => {
  it('omits the defaults, so a fresh page has a clean address bar', () => {
    expect(serializeNotificationFilters(DEFAULT_NOTIFICATION_FILTERS)).toBe('');
  });

  it('serialises only what differs', () => {
    expect(serializeNotificationFilters({ period: '30d', status: 'all' })).toBe('period=30d');
    expect(serializeNotificationFilters({ period: '7d', status: 'unread' })).toBe('status=unread');
  });

  it('reads back what it wrote', () => {
    const state = { period: '90d', status: 'unread' } as const;
    const parsed = parseNotificationFilters(new URLSearchParams(serializeNotificationFilters(state)));
    expect(parsed).toEqual(state);
  });

  it('falls back to the defaults for a value it does not know', () => {
    const parsed = parseNotificationFilters(new URLSearchParams('period=forever&status=maybe'));
    expect(parsed).toEqual(DEFAULT_NOTIFICATION_FILTERS);
  });
});

describe('groupByDay', () => {
  const notification = (id: string, createdAt: string) =>
    ({ id, createdAt, title: id, message: '', read: false }) as AppNotification;

  it('labels the two most recent days in words', () => {
    const groups = groupByDay(
      [
        notification('a', '2026-08-15T14:00:00Z'), // 10:00 local, today
        notification('b', '2026-08-15T12:00:00Z'), // 08:00 local, today
        notification('c', '2026-08-14T18:00:00Z'), // 14:00 local, yesterday
      ],
      NOW,
    );

    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['c']);
  });

  it('splits days at midnight in the account‘s zone, not UTC‘s', () => {
    // 02:00 UTC on the 15th is still 22:00 on the 14th in Santo Domingo, so
    // these two belong to the same local day despite differing UTC dates.
    const groups = groupByDay(
      [notification('late', '2026-08-15T02:00:00Z'), notification('evening', '2026-08-15T01:00:00Z')],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Yesterday');
  });

  it('dates anything older than yesterday', () => {
    const groups = groupByDay([notification('old', '2026-08-02T16:00:00Z')], NOW);

    expect(groups[0].key).toBe('2026-08-02');
    expect(groups[0].label).toBe('2026-08-02');
  });

  it('returns nothing for an empty page', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
