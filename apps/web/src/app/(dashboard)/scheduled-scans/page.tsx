'use client';

import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { IconCalendarClock, IconPlus } from '@tabler/icons-react';
import { scheduledScansApi } from '@/lib/api';
import type { Paginated, ScheduledScan } from '@/types';
import {
  EMPTY_SCHEDULE_FILTERS,
  FREQUENCY_LABELS,
  formatCountdown,
  formatRunAt,
  hasActiveScheduleFilters,
  nextRunLabel,
  parseScheduleFilters,
  parseSchedulePage,
  serializeScheduleFilters,
  toApiValue,
  type ScheduleFilterState,
} from '@/lib/schedule-list';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { ScheduleFilters } from '@/components/scheduled-scans/schedule-filters';
import { ScheduleStatusBadge } from '@/components/scheduled-scans/schedule-status-badge';
import { ScheduleActions } from '@/components/scheduled-scans/schedule-actions';
import { ScheduleSheet } from '@/components/scheduled-scans/schedule-sheet';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 20;

/**
 * Every automatic scan in one table.
 *
 * Filters and page live in the URL, so a filtered view is shareable and
 * survives a reload — the same arrangement the Issues and Scans lists use, and
 * what lets the dashboard link straight to a filtered view.
 */
export default function ScheduledScansPage() {
  const { canWrite } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseScheduleFilters(params), [params]);
  const page = parseSchedulePage(params);

  const replaceQuery = useCallback(
    (query: string) => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    [pathname, router],
  );

  const applyFilters = useCallback(
    (next: ScheduleFilterState) => replaceQuery(serializeScheduleFilters(next)),
    [replaceQuery],
  );

  const goToPage = useCallback(
    (next: number) => replaceQuery(serializeScheduleFilters(filters, Math.max(1, next))),
    [filters, replaceQuery],
  );

  const { data, isLoading, isError } = useQuery<Paginated<ScheduledScan>>({
    queryKey: ['scheduled-scans', 'list', filters, page],
    queryFn: () =>
      scheduledScansApi.list({
        search: filters.search || undefined,
        status: toApiValue(filters.status) ? [filters.status] : undefined,
        frequency: toApiValue(filters.frequency) ? [filters.frequency] : undefined,
        projectId: toApiValue(filters.projectId),
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    // A schedule's status changes without anyone touching the page — a run
    // starts at 02:00 whether or not this tab is open. Polling keeps the table
    // honest; nothing here drives the scheduler, which runs entirely on the
    // server.
    refetchInterval: 30_000,
  });

  // A `?page=` past the end — a stale link, or a filter narrowing the set —
  // would render an empty table over a non-empty result set.
  useEffect(() => {
    if (!data || data.totalPages < 1 || page <= data.totalPages) return;
    replaceQuery(serializeScheduleFilters(filters, data.totalPages));
  }, [data, page, filters, replaceQuery]);

  const filtersActive = hasActiveScheduleFilters(filters);

  const columns = useMemo<ColumnDef<ScheduledScan>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/scheduled-scans/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {/* The rule in words, straight from the server. */}
            <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>
          </div>
        ),
      },
      {
        id: 'project',
        header: 'Project',
        meta: { className: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <Link
            href={`/projects/${row.original.projectId}`}
            className="text-sm hover:underline"
          >
            {row.original.project.name}
          </Link>
        ),
      },
      {
        accessorKey: 'frequency',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Frequency" />,
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <span className="text-sm">{FREQUENCY_LABELS[row.original.frequency]}</span>
        ),
        size: 110,
      },
      {
        accessorKey: 'lastRunAt',
        header: 'Last run',
        meta: { className: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRunAt(row.original.lastRunAt, row.original.timezone)}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: 'nextRunAt',
        header: 'Next run',
        cell: ({ row }) => {
          const schedule = row.original;
          return (
            <div className="min-w-0">
              <p className="text-sm">
                {nextRunLabel(schedule.nextRunAt, schedule.displayStatus, schedule.timezone)}
              </p>
              {schedule.nextRunAt && schedule.displayStatus !== 'PAUSED' && (
                // The absolute time answers "will this hit the maintenance
                // window?"; the relative one answers "is it soon?". Both are
                // needed, so both are shown.
                <p className="text-xs text-muted-foreground">
                  {formatCountdown(schedule.nextRunAt)} · {schedule.timezoneOffset}
                </p>
              )}
            </div>
          );
        },
        size: 170,
      },
      {
        accessorKey: 'displayStatus',
        header: 'Status',
        cell: ({ row }) => <ScheduleStatusBadge status={row.original.displayStatus} />,
        size: 120,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ScheduleActions schedule={row.original} />
          </div>
        ),
        size: 56,
      },
    ],
    [],
  );

  const schedules = data?.data ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="Scheduled Scans"
        description="Assessments that run on their own. They keep running while nobody is here — the scheduler lives on the server, not in this page."
        actions={
          canWrite ? (
            <ScheduleSheet
              trigger={
                <Button>
                  <IconPlus className="size-4" />
                  New schedule
                </Button>
              }
            />
          ) : undefined
        }
      />

      <ScheduleFilters value={filters} onChange={applyFilters} />

      {isError ? (
        <EmptyState
          icon={IconCalendarClock}
          title="Could not load scheduled scans"
          description="Try again in a moment."
        />
      ) : isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={IconCalendarClock}
          title={filtersActive ? 'No schedules match these filters' : 'No scheduled scans yet'}
          description={
            filtersActive
              ? 'Clear the filters to see all schedules.'
              : 'Schedule a recurring assessment so an API is checked without anyone having to remember.'
          }
          action={
            filtersActive ? (
              <Button variant="outline" size="sm" onClick={() => applyFilters(EMPTY_SCHEDULE_FILTERS)}>
                Clear filters
              </Button>
            ) : canWrite ? (
              <ScheduleSheet
                trigger={
                  <Button size="sm">
                    <IconPlus className="size-4" />
                    New schedule
                  </Button>
                }
              />
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable columns={columns} data={schedules} hideToolbar />

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.page} of {data.totalPages} · {data.total} schedule
                {data.total === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
