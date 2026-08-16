import { formatDay, zonedDayKey } from './user-preferences';
import type { AppNotification } from '@/types';

/**
 * The notifications screen: how far back it looks, and how its rows are grouped.
 *
 * Kept out of the component for the same reason the Issues and Schedules lists
 * keep theirs here — the period arithmetic and the URL round trip are the parts
 * worth testing, and the bell's panel links to a filtered view without pulling
 * the page in.
 */

export const NOTIFICATION_PERIODS = ['24h', '7d', '30d', '90d', 'all'] as const;
export type NotificationPeriod = (typeof NOTIFICATION_PERIODS)[number];

export const PERIOD_LABELS: Record<NotificationPeriod, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

/** How the period reads inside a sentence, for the page description. */
export const PERIOD_PHRASES: Record<NotificationPeriod, string> = {
  '24h': 'in the last 24 hours',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
  '90d': 'in the last 90 days',
  all: 'since this account was created',
};

/** Hours per period. Elapsed time, not calendar days — see `sinceFor`. */
const PERIOD_HOURS: Record<Exclude<NotificationPeriod, 'all'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
};

export type NotificationReadFilter = 'all' | 'unread';

export interface NotificationFilterState {
  period: NotificationPeriod;
  status: NotificationReadFilter;
}

/**
 * A week, and everything in it.
 *
 * Long enough that a scan from last Monday is still on the first screen, short
 * enough that the default view is not a year of history nobody scrolls.
 */
export const DEFAULT_NOTIFICATION_FILTERS: NotificationFilterState = {
  period: '7d',
  status: 'all',
};

/**
 * The `createdAt` floor a period denotes, or `undefined` for all time.
 *
 * Elapsed time rather than calendar days on purpose: "last 24 hours" at 09:00
 * has to mean since 09:00 yesterday. A midnight boundary would make the same
 * filter return a different window depending on the hour it was applied, which
 * is exactly the surprise a period filter should not contain.
 */
export function sinceFor(period: NotificationPeriod, now: Date = new Date()): string | undefined {
  if (period === 'all') return undefined;
  return new Date(now.getTime() - PERIOD_HOURS[period] * 3_600_000).toISOString();
}

function isPeriod(value: string | null): value is NotificationPeriod {
  return value !== null && (NOTIFICATION_PERIODS as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to the defaults rather than erroring. */
export function parseNotificationFilters(params: URLSearchParams): NotificationFilterState {
  const period = params.get('period');
  return {
    period: isPeriod(period) ? period : DEFAULT_NOTIFICATION_FILTERS.period,
    status: params.get('status') === 'unread' ? 'unread' : 'all',
  };
}

/**
 * Filters as a query string, with the defaults omitted.
 *
 * A default that serialised would put `?period=7d&status=all` in the address bar
 * the moment the page loads, which reads as a filter somebody applied.
 */
export function serializeNotificationFilters(state: NotificationFilterState): string {
  const params = new URLSearchParams();
  if (state.period !== DEFAULT_NOTIFICATION_FILTERS.period) params.set('period', state.period);
  if (state.status !== DEFAULT_NOTIFICATION_FILTERS.status) params.set('status', state.status);
  return params.toString();
}

export interface NotificationDayGroup {
  /** `2026-08-14` in the account's zone. Identity, not display. */
  key: string;
  /** "Today", "Yesterday", or the date in the account's format. */
  label: string;
  items: AppNotification[];
}

/**
 * Rows split into calendar days.
 *
 * Days are decided by `zonedDayKey`, so the split happens at midnight in the
 * account's own timezone rather than the browser's or UTC's — an operator whose
 * profile is pinned to Tokyo should not see this morning's scan filed under
 * yesterday.
 *
 * Assumes the newest-first order the API returns, so a day is closed as soon as
 * a different one appears rather than requiring a second pass.
 */
export function groupByDay(
  items: AppNotification[],
  now: Date = new Date(),
): NotificationDayGroup[] {
  const today = zonedDayKey(now);
  const yesterday = zonedDayKey(new Date(now.getTime() - 86_400_000));

  const groups: NotificationDayGroup[] = [];

  for (const item of items) {
    const key = zonedDayKey(item.createdAt);
    const current = groups[groups.length - 1];

    if (current?.key === key) {
      current.items.push(item);
      continue;
    }

    groups.push({
      key,
      label:
        key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDay(item.createdAt),
      items: [item],
    });
  }

  return groups;
}
