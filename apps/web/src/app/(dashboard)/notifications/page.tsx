'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { IconBell, IconCheck } from '@tabler/icons-react';
import { notificationsApi } from '@/lib/api';
import {
  NOTIFICATION_PERIODS,
  PERIOD_LABELS,
  PERIOD_PHRASES,
  groupByDay,
  parseNotificationFilters,
  serializeNotificationFilters,
  sinceFor,
  type NotificationFilterState,
} from '@/lib/notification-list';
import {
  NOTIFICATION_LIST_KEY,
  useNotificationActions,
  useNotificationSummary,
} from '@/hooks/use-notification-summary';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { FilterSelect, type FilterSelectOption } from '@/components/filters/filter-select';
import { NotificationRow } from '@/components/notifications/notification-item';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

/** One screenful and a bit, so the first "Load more" is a deliberate act. */
const PAGE_SIZE = 25;

const PERIOD_OPTIONS: FilterSelectOption[] = NOTIFICATION_PERIODS.map((period) => ({
  value: period,
  label: PERIOD_LABELS[period],
}));

const STATUS_OPTIONS: FilterSelectOption[] = [
  { value: 'all', label: 'All notifications' },
  { value: 'unread', label: 'Unread only' },
];

/**
 * Everything the bell only shows the top of.
 *
 * The panel in the header is a preview of the last eight; this is the history,
 * filtered by how far back to look. Filters live in the URL so a view is
 * shareable and survives a reload, the same arrangement Issues and Schedules
 * use.
 *
 * Nothing is marked read by arriving here. Opening the screen is not reading
 * the items on it, and a page that cleared the badge on sight would destroy the
 * one signal telling the user which rows they have not dealt with.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseNotificationFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const applyFilters = useCallback(
    (next: NotificationFilterState) => {
      const query = serializeNotificationFilters(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const summary = useNotificationSummary();
  const { markRead, markAllRead } = useNotificationActions();

  /*
   * Pinned per period rather than recomputed each render.
   *
   * `sinceFor` reads the clock, so an unmemoised value would differ on every
   * render — and since it feeds the query, every render would be a cache miss
   * and a new request. The period is what the reader chose; the instant it
   * resolves to only needs to be stable while they are looking at it.
   */
  const since = useMemo(() => sinceFor(filters.period), [filters.period]);

  const query = useInfiniteQuery({
    // Shares the `['notifications','list']` prefix, so the live stream's
    // invalidation refreshes this screen as well as the bell.
    queryKey: [...NOTIFICATION_LIST_KEY, 'page', filters.period, filters.status],
    queryFn: ({ pageParam }) =>
      notificationsApi.list({
        limit: PAGE_SIZE,
        offset: pageParam,
        unreadOnly: filters.status === 'unread',
        since,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.items.length;
      // An empty page ends the list even if `total` disagrees — it can, because
      // rows arrive between requests.
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const groups = useMemo(() => groupByDay(items), [items]);
  const total = query.data?.pages[0]?.total ?? 0;

  const description =
    query.isLoading || query.isError
      ? `Everything that happened ${PERIOD_PHRASES[filters.period]}.`
      : `${total} notification${total === 1 ? '' : 's'} ${PERIOD_PHRASES[filters.period]}` +
        (summary.totalUnread > 0 ? ` · ${summary.totalUnread} unread in total.` : '.');

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description={description}
        actions={
          summary.totalUnread > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <IconCheck className="size-4" />
              Mark all as read
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 md:grid-cols-[13rem_13rem]">
        <FilterSelect
          label="Period"
          id="notification-filter-period"
          options={PERIOD_OPTIONS}
          value={filters.period}
          onChange={(next) =>
            applyFilters({ ...filters, period: next as NotificationFilterState['period'] })
          }
        />
        <FilterSelect
          label="Status"
          id="notification-filter-status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(next) =>
            applyFilters({ ...filters, status: next as NotificationFilterState['status'] })
          }
        />
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex gap-3 px-4 py-3">
                <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState
            icon={IconBell}
            title="Notifications could not be loaded"
            description="The request failed. Try again in a moment."
            action={
              <Button variant="outline" size="sm" onClick={() => query.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={IconBell}
            title={filters.status === 'unread' ? 'Nothing unread here' : 'Nothing in this period'}
            description={
              filters.status === 'unread'
                ? 'Everything in this period has been read.'
                : filters.period === 'all'
                  ? 'Scans, reports and findings will appear here as they happen.'
                  : 'Widen the period to look further back.'
            }
            action={
              filters.period === 'all' ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyFilters({ ...filters, period: 'all' })}
                >
                  Show all time
                </Button>
              )
            }
          />
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              {/*
                Not sticky: the card clips its corners with `overflow-hidden`,
                which makes it the sticky containing block, and a container that
                does not scroll is one a heading cannot stick inside. A heading
                that silently never sticks is worse than one that plainly
                scrolls with its day.
              */}
              <h2 className="border-y border-border bg-muted/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h2>
              <ul className="divide-y divide-border">
                {group.items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    timestamp="time"
                    onOpen={() => {
                      if (!notification.read) markRead.mutate(notification.id);
                    }}
                    onMarkRead={() => markRead.mutate(notification.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            Load more
          </Button>
        </div>
      )}

      {!query.isLoading && !query.hasNextPage && items.length > 0 && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          That is everything {PERIOD_PHRASES[filters.period]}.
        </p>
      )}
    </PageContainer>
  );
}
