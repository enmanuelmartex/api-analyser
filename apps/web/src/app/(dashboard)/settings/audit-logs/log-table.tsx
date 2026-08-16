'use client';

import * as React from 'react';
import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconClipboardList,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { cn, formatDay, formatTimeOfDay } from '@/lib/utils';
import { isSameZonedDay } from '@/lib/user-preferences';
import type { AuditLog } from '@/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LogCategoryBadge,
  LogSeverityBadge,
  LogStatusBadge,
  humaniseEvent,
} from '../_components/log-badges';

export type SortField = 'createdAt' | 'severity' | 'category' | 'event';

/** Column ids in display order, with the labels the column picker shows. */
export const LOG_COLUMNS: { id: string; label: string }[] = [
  { id: 'createdAt', label: 'Timestamp' },
  { id: 'severity', label: 'Severity' },
  { id: 'event', label: 'Event' },
  { id: 'category', label: 'Category' },
  { id: 'user', label: 'User' },
  { id: 'ipAddress', label: 'IP' },
  { id: 'route', label: 'Endpoint' },
  { id: 'status', label: 'Status' },
];

/**
 * The audit history grid.
 *
 * Explicitly NOT the shared `components/tables/data-table`: that one is fully
 * client-side (`getPaginationRowModel`, `getFilteredRowModel`), which means it
 * needs every row in memory to do its job. This table is backed by a table that
 * can hold hundreds of thousands of rows, so sorting, filtering and pagination
 * are all the server's job and this renders exactly the page it was handed.
 *
 * The columns are deliberately few. The full record has thirty fields; putting
 * them all here produces a grid nobody can read. The table answers "what
 * happened, when, to whom, did it work" and the row opens the rest.
 *
 * Column visibility is owned by the parent so the toolbar's picker and this
 * table share one state, and so the choice can be persisted per browser.
 */
export function LogTable({
  rows,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
  isLoading,
  isFetching,
  isError,
  error,
  columnVisibility,
  onColumnVisibilityChange,
  onRetry,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  selectedId,
}: {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: SortField;
  sortDir: 'asc' | 'desc';
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error?: unknown;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: React.Dispatch<React.SetStateAction<VisibilityState>>;
  onRetry: () => void;
  // eslint-disable-next-line no-unused-vars
  onSort: (field: SortField) => void;
  // eslint-disable-next-line no-unused-vars
  onPageChange: (page: number) => void;
  // eslint-disable-next-line no-unused-vars
  onPageSizeChange: (size: number) => void;
  // eslint-disable-next-line no-unused-vars
  onRowClick: (log: AuditLog) => void;
  selectedId: string | null;
}) {
  const columns = React.useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: 'Timestamp',
        meta: { className: 'w-[140px]' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
            {formatTimestamp(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'severity',
        accessorKey: 'severity',
        header: 'Severity',
        meta: { className: 'w-[92px]' },
        cell: ({ row }) => <LogSeverityBadge severity={row.original.severity} />,
      },
      {
        id: 'event',
        accessorKey: 'event',
        header: 'Event',
        // The one column that must not be capped: it carries the sentence an
        // operator is scanning for.
        meta: { className: 'min-w-[220px]' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {row.original.message || humaniseEvent(row.original.event)}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {row.original.event}
            </p>
          </div>
        ),
      },
      {
        id: 'category',
        accessorKey: 'category',
        header: 'Category',
        meta: { className: 'w-[130px]' },
        cell: ({ row }) => <LogCategoryBadge category={row.original.category} />,
      },
      {
        id: 'user',
        header: 'User',
        meta: { className: 'w-[150px]' },
        cell: ({ row }) => (
          <span className="block truncate text-xs text-muted-foreground">
            {row.original.user?.name ?? (
              <span className="text-muted-foreground/60">{row.original.source ?? 'system'}</span>
            )}
          </span>
        ),
      },
      {
        id: 'ipAddress',
        accessorKey: 'ipAddress',
        header: 'IP',
        meta: { className: 'w-[120px]' },
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.original.ipAddress ?? '—'}
          </span>
        ),
      },
      {
        id: 'route',
        accessorKey: 'route',
        header: 'Endpoint',
        meta: { className: 'w-[190px]' },
        cell: ({ row }) =>
          row.original.route ? (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.original.httpMethod ? `${row.original.httpMethod} ` : ''}
              {row.original.route}
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        meta: { className: 'w-[92px]' },
        cell: ({ row }) => <LogStatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Every model except the core one is omitted: the server already sorted,
    // filtered and paginated. Enabling them here would re-sort the current page
    // in isolation, which looks like it works and is wrong on every page but
    // the first.
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    state: { columnVisibility },
    onColumnVisibilityChange,
    getRowId: (row) => row.id,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min((page + 1) * pageSize, total);
  const visibleColumns = table.getVisibleFlatColumns();

  const SORTABLE: SortField[] = ['createdAt', 'severity', 'category', 'event'];

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                  {headerGroup.headers.map((header) => {
                    const field = header.column.id as SortField;
                    const sortable = SORTABLE.includes(field);
                    const active = sortBy === field;

                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          'h-9 text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
                          (header.column.columnDef.meta as any)?.className,
                        )}
                        aria-sort={
                          active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => onSort(field)}
                            className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {active ? (
                              sortDir === 'asc' ? (
                                <IconArrowUp className="h-3 w-3 text-primary" />
                              ) : (
                                <IconArrowDown className="h-3 w-3 text-primary" />
                              )
                            ) : (
                              <IconArrowsSort className="h-3 w-3 opacity-30" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody
              // Dims the page while the next one loads, instead of collapsing
              // the table to skeletons and jumping the scroll position.
              className={cn(
                'transition-opacity',
                isFetching && !isLoading && 'opacity-60',
              )}
            >
              {isLoading &&
                Array.from({ length: 10 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn('py-2', (column.columnDef.meta as any)?.className)}
                      >
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!isLoading &&
                !isError &&
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => onRowClick(row.original)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row.original);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open event ${row.original.event}`}
                    className={cn(
                      'cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                      selectedId === row.original.id && 'bg-primary/[0.07]',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'max-w-0 py-2 align-middle',
                          (cell.column.columnDef.meta as any)?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!isLoading && !isError && rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={visibleColumns.length} className="p-0">
                    <EmptyState
                      icon={IconClipboardList}
                      title="No events match these filters"
                      description="Widen the date range or clear a filter to see more."
                    />
                  </TableCell>
                </TableRow>
              )}

              {isError && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={visibleColumns.length} className="p-6">
                    <Alert variant="destructive">
                      <IconAlertTriangle />
                      <div className="flex-1">
                        <AlertDescription>
                          {(error as any)?.response?.data?.message ??
                            'Could not load events. The API did not respond.'}
                        </AlertDescription>
                        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                          Retry
                        </Button>
                      </div>
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination stays mounted while loading so the control does not jump. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isLoading ? (
            <Skeleton className="inline-block h-3 w-40 align-middle" />
          ) : (
            <>
              Showing{' '}
              <span className="font-medium tabular-nums text-foreground">
                {firstRow.toLocaleString()}–{lastRow.toLocaleString()}
              </span>{' '}
              of <span className="font-medium tabular-nums text-foreground">
                {total.toLocaleString()}
              </span>{' '}
              event{total === 1 ? '' : 's'}
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end lg:gap-4">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger className="h-8 w-[72px] text-xs" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* 10 is here for the short window an operator reads in full —
                    a filtered status over the last hour — where 25 rows is
                    already more scrolling than the result deserves. */}
                {[10, 25, 50, 100, 200].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <PageNumbers
            page={page}
            totalPages={totalPages}
            disabled={isLoading}
            onPageChange={onPageChange}
          />
        </div>
      </div>
    </div>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * Numbered pages with a sliding window.
 *
 * A log table routinely runs to hundreds of pages, so the full run is never
 * rendered: first and last are always reachable, two neighbours either side of
 * the current page are shown, and the gaps collapse to an ellipsis. Below `sm`
 * the numbers give way to "Page 4 of 968" — five 36px targets and two arrows do
 * not fit on a phone, and shrinking them below the touch minimum is worse than
 * dropping them.
 */
function PageNumbers({
  page,
  totalPages,
  disabled,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  // eslint-disable-next-line no-unused-vars
  onPageChange: (page: number) => void;
}) {
  const current = page + 1;

  const items = React.useMemo(() => {
    const window = new Set<number>([1, totalPages, current]);
    for (let offset = 1; offset <= 2; offset += 1) {
      if (current - offset >= 1) window.add(current - offset);
      if (current + offset <= totalPages) window.add(current + offset);
    }

    const sorted = [...window].sort((a, b) => a - b);
    const out: (number | 'gap')[] = [];
    sorted.forEach((value, index) => {
      if (index > 0 && value - sorted[index - 1] > 1) out.push('gap');
      out.push(value);
    });
    return out;
  }, [current, totalPages]);

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            className="h-8 px-2 text-xs"
            disabled={disabled || current === 1}
            onClick={() => onPageChange(page - 1)}
          >
            <span className="hidden sm:inline">Previous</span>
          </PaginationPrevious>
        </PaginationItem>

        <li className="px-2 text-xs text-muted-foreground sm:hidden" aria-current="page">
          Page <span className="tabular-nums text-foreground">{current.toLocaleString()}</span> of{' '}
          <span className="tabular-nums text-foreground">{totalPages.toLocaleString()}</span>
        </li>

        {items.map((item, index) =>
          item === 'gap' ? (
            <PaginationItem key={`gap-${index}`} className="hidden sm:block">
              <PaginationEllipsis className="size-8" />
            </PaginationItem>
          ) : (
            <PaginationItem key={item} className="hidden sm:block">
              <PaginationLink
                className="size-8 text-xs tabular-nums"
                isActive={item === current}
                disabled={disabled}
                onClick={() => onPageChange(item - 1)}
                aria-label={`Go to page ${item}`}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationNext
            className="h-8 px-2 text-xs"
            disabled={disabled || current >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <span className="hidden sm:inline">Next</span>
          </PaginationNext>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

/**
 * Compact but unambiguous: same-day events show time only, older ones the date.
 *
 * "Same day" is decided in the account's timezone, not the browser's. The
 * previous version compared `getDate()`/`getMonth()`/`getFullYear()` against
 * `new Date()`, which asks the question in whatever zone the laptop is set to —
 * so an operator whose profile is pinned to another region would see this
 * morning's events stamped with yesterday's date while every other timestamp on
 * the screen said today.
 */
function formatTimestamp(iso: string): string {
  const time = formatTimeOfDay(iso, undefined, { seconds: true });
  if (isSameZonedDay(iso, Date.now())) return time;
  return `${formatDay(iso)} ${time}`;
}
