'use client';

import * as React from 'react';
import type { VisibilityState } from '@tanstack/react-table';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { IconActivityHeartbeat, IconHistory, IconSettings } from '@tabler/icons-react';
import { logsApi, usersApi } from '@/lib/api';
import type { LogStatus, ManagedUser } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStoredState } from '../_components/use-stored-state';
import { LogTable, type SortField } from './log-table';
import { LogColumnPicker } from './log-column-picker';
import { LogExportButton } from './log-export';
import { LogDetailSheet } from './log-detail-sheet';
import { LiveEvents } from './live-events';
import { LogManagement } from './log-management';
import { AuditSummary } from './audit-summary';
import {
  EMPTY_FILTERS,
  LogFilters,
  RANGE_LABELS,
  resolveRange,
  type LogFilterState,
} from './log-filters';

/** Debounce for the search box, so typing does not issue a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS_STORAGE_KEY = 'api-analyser.audit-logs.columns';

/**
 * Audit Logs.
 *
 * Three views over the same data, which is why they are sub-tabs rather than
 * three screens:
 *
 *   Live events    — what is happening now (SSE, in-memory, lossy).
 *   Audit history  — what happened (the table, server-filtered and paginated).
 *   Log management — how much of it is kept, and for how long.
 *
 * Opening an event from either of the first two uses the same detail sheet, so
 * an operator who spots something in the live tail can drill into the full
 * record without switching views first.
 */
export function AuditLogsTab({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = React.useState('history');
  const [filters, setFilters] = React.useState<LogFilterState>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(50);
  const [sortBy, setSortBy] = React.useState<SortField>('createdAt');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const [openLogId, setOpenLogId] = React.useState<string | null>(null);

  const [columnVisibility, setColumnVisibility, columnsHydrated] =
    useStoredState<VisibilityState>(COLUMNS_STORAGE_KEY, {}, isVisibilityState);

  /*
   * On a narrow viewport the two widest columns start hidden — but only until
   * the operator has expressed a preference, after which the stored value wins
   * on every screen. Hiding them permanently by breakpoint would make the
   * column picker lie: it would report Endpoint as visible while CSS suppressed
   * it.
   */
  const appliedDefaults = React.useRef(false);
  React.useEffect(() => {
    if (!columnsHydrated || appliedDefaults.current) return;
    appliedDefaults.current = true;

    const stored = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored === null && window.innerWidth < 1024) {
      setColumnVisibility({ ipAddress: false, route: false });
    }
  }, [columnsHydrated, setColumnVisibility]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  /*
   * Depends on the three range fields, NOT on `filters` as a whole.
   *
   * `resolveRange` resolves a preset against `Date.now()`, so recomputing it
   * yields a new `from` every time. Keying it on the whole object would produce
   * a fresh timestamp on each keystroke in the search box, which lands in the
   * query key and issues a request per character — defeating the debounce above
   * and firing four requests each time (the page plus the three status counts).
   */
  const { range: rangePreset, customFrom, customTo } = filters;
  const range = React.useMemo(
    () => resolveRange({ ...EMPTY_FILTERS, range: rangePreset, customFrom, customTo }),
    [rangePreset, customFrom, customTo],
  );

  /** The filter half of the query, shared by the table and the summary counts. */
  const queryFilters = React.useMemo(
    () => ({
      search: debouncedSearch || undefined,
      severity: filters.severity.length ? filters.severity : undefined,
      category: filters.category.length ? filters.category : undefined,
      status: filters.status.length ? filters.status : undefined,
      userId: filters.userId || undefined,
      event: filters.event || undefined,
      from: range.from,
      to: range.to,
    }),
    [
      debouncedSearch,
      filters.severity,
      filters.category,
      filters.status,
      filters.userId,
      filters.event,
      range.from,
      range.to,
    ],
  );

  const logs = useQuery({
    queryKey: ['audit-logs', 'list', queryFilters, { page, pageSize, sortBy, sortDir }],
    queryFn: () =>
      logsApi.list({
        ...queryFilters,
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortDir,
      }),
    // Keeps the previous page rendered while the next loads, so paging does not
    // collapse the table to a skeleton and jump the scroll position.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  /*
   * The summary counts.
   *
   * One `limit=1` request per status against the list endpoint, reusing the
   * active filters. The server already computes `total` for any filter
   * combination, so this needs no new route and each response carries a single
   * row. The overall total comes from the table's own query rather than a
   * fourth request.
   *
   * `status` is deliberately the split rather than `severity`: a WARNING-level
   * event that succeeded is not an error, and an operator triaging a window
   * wants to know what failed.
   *
   * When the operator has filtered by status, a status they excluded is not
   * requested at all and counts as zero. Narrowing `status` to the tile's own
   * value would otherwise ask the server a different question from the one the
   * table is asking — filtering to SUCCESS would still report a non-zero error
   * count, describing events that are not in the result set below it, and the
   * shares would sum past 100%.
   */
  const statusCounts = useQueries({
    queries: (['SUCCESS', 'WARNING', 'FAILED'] as const).map((status) => {
      const included = filters.status.length === 0 || filters.status.includes(status);
      return {
        queryKey: ['audit-logs', 'count', queryFilters, status],
        queryFn: () =>
          logsApi
            .list({ ...queryFilters, status: [status], limit: 1, offset: 0 })
            .then((result) => result.total),
        enabled: included,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
      };
    }),
  });

  const [success, warning, failed] = statusCounts;

  /** A status the filter excludes contributes nothing, and is never requested. */
  const countFor = (
    query: (typeof statusCounts)[number],
    status: 'SUCCESS' | 'WARNING' | 'FAILED',
  ) => (filters.status.length === 0 || filters.status.includes(status) ? (query.data ?? 0) : 0);

  // Both only feed filter dropdowns, so they are cheap and long-lived.
  const users = useQuery<ManagedUser[]>({
    queryKey: ['users'],
    queryFn: usersApi.list,
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  });

  const events = useQuery({
    queryKey: ['audit-logs', 'events'],
    queryFn: logsApi.events,
    staleTime: 5 * 60_000,
  });

  const stats = useQuery({
    queryKey: ['audit-logs', 'stats'],
    queryFn: logsApi.stats,
    staleTime: 60_000,
  });

  function patchFilters(patch: Partial<LogFilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
    // Any filter change invalidates the current offset: staying on page 7 of a
    // result set that now has two pages shows an empty table.
    setPage(0);
  }

  /**
   * A summary tile was clicked.
   *
   * Writes the `status` filter the filter bar already owns — there is no second
   * filter path — so the chip in the bar, the tile's pressed state and the table
   * cannot drift apart. Clicking the active tile again clears it, which is the
   * only way back out of a filter applied by a click. `null` is the Total tile.
   *
   * The view switches to the history table because that is what the filter acts
   * on: applying it from the Live events or Log management tab would otherwise
   * change something the operator cannot see.
   */
  function selectStatus(status: LogStatus | null) {
    const alreadyOnlyStatus =
      status !== null && filters.status.length === 1 && filters.status[0] === status;
    patchFilters({ status: status === null || alreadyOnlyStatus ? [] : [status] });
    setView('history');
  }

  function handleSort(field: SortField) {
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(0);
  }

  const summaryLoading =
    logs.isLoading || success.isLoading || warning.isLoading || failed.isLoading;

  const rangeLabel =
    filters.range === 'custom' && filters.customFrom
      ? `${filters.customFrom.toLocaleDateString()} – ${filters.customTo?.toLocaleDateString() ?? 'now'}`
      : RANGE_LABELS[filters.range];

  return (
    <div className="space-y-5">
      <AuditSummary
        isLoading={summaryLoading}
        rangeLabel={rangeLabel}
        counts={{
          total: logs.data?.total ?? 0,
          success: countFor(success, 'SUCCESS'),
          warning: countFor(warning, 'WARNING'),
          failed: countFor(failed, 'FAILED'),
        }}
        stream={{
          enabled: stats.data?.policy.liveStreamEnabled ?? true,
          subscribers: stats.data?.liveSubscribers ?? null,
        }}
        activeStatuses={filters.status}
        onSelectStatus={selectStatus}
      />

      <Tabs value={view} onValueChange={setView} className="space-y-4">
        <TabsList>
          <TabsTrigger value="live" className="gap-1.5">
            <IconActivityHeartbeat className="h-3.5 w-3.5" />
            Live events
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <IconHistory className="h-3.5 w-3.5" />
            Audit history
          </TabsTrigger>
          <TabsTrigger value="management" className="gap-1.5">
            <IconSettings className="h-3.5 w-3.5" />
            Log management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-0">
          <LiveEvents
            streamEnabled={stats.data?.policy.liveStreamEnabled ?? true}
            onOpenEvent={setOpenLogId}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-0 space-y-3">
          <LogFilters
            state={filters}
            onChange={patchFilters}
            onReset={() => {
              setFilters(EMPTY_FILTERS);
              setPage(0);
            }}
            users={users.data ?? []}
            events={events.data ?? []}
            trailing={
              <>
                <LogExportButton
                  filters={queryFilters}
                  scopeLabel="Events matching the current filters"
                />
                <LogColumnPicker
                  visibility={columnVisibility}
                  onChange={setColumnVisibility}
                />
              </>
            }
          />

          <LogTable
            rows={logs.data?.items ?? []}
            total={logs.data?.total ?? 0}
            page={page}
            pageSize={pageSize}
            sortBy={sortBy}
            sortDir={sortDir}
            isLoading={logs.isLoading}
            isFetching={logs.isFetching}
            isError={logs.isError}
            error={logs.error}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            onRetry={() => logs.refetch()}
            onSort={handleSort}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            onRowClick={(log) => setOpenLogId(log.id)}
            selectedId={openLogId}
          />
        </TabsContent>

        <TabsContent value="management" className="mt-0">
          <LogManagement isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>

      <LogDetailSheet
        logId={openLogId}
        open={Boolean(openLogId)}
        onOpenChange={(open) => !open && setOpenLogId(null)}
      />
    </div>
  );
}

/** Guards the stored value: anything else in that key falls back to the default. */
function isVisibilityState(value: unknown): value is VisibilityState {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  );
}
