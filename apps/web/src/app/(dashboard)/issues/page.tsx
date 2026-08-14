'use client';

import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { IconBug } from '@tabler/icons-react';
import { issuesApi } from '@/lib/api';
import {
  EMPTY_ISSUE_FILTERS,
  hasActiveIssueFilters,
  parseIssueFilters,
  parseIssuePage,
  serializeIssueFilters,
  toApiValue,
  type IssueFilterState,
} from '@/lib/issue-list';
import type { Paginated, SecurityIssue } from '@/types';
import { useMarkSectionSeen } from '@/hooks/use-notification-summary';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { IssueStatsStrip } from '@/components/issues/issue-stats-strip';
import { IssueFilters } from '@/components/issues/issue-filters';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { SeverityBadge } from '@/components/security/severity-badge';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { MethodBadge } from '@/components/security/method-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

export default function IssuesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Arriving here is what "seen" means for the Issues badge. Fires once, and
  // only when there is something to clear.
  useMarkSectionSeen('issues');

  // Filters and page live in the URL, so a filtered view is shareable, survives
  // a reload, and can be reached straight from a summary card. Local state would
  // be a second copy of the same thing and the cards could not write to it.
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseIssueFilters(params), [params]);
  const page = parseIssuePage(params);

  const replaceQuery = useCallback(
    (query: string) => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    [pathname, router],
  );

  // Any filter change returns to page 1: keeping the offset would land on an
  // empty page whenever the narrower result set is shorter than the old one.
  const applyFilters = useCallback(
    (next: IssueFilterState) => replaceQuery(serializeIssueFilters(next)),
    [replaceQuery],
  );

  const goToPage = useCallback(
    (next: number) => replaceQuery(serializeIssueFilters(filters, Math.max(1, next))),
    [filters, replaceQuery],
  );

  const { data, isLoading, isError } = useQuery<Paginated<SecurityIssue>>({
    queryKey: ['issues', 'list', filters.severity, filters.status, filters.search, page],
    queryFn: () =>
      issuesApi.list({
        severity: toApiValue(filters.severity),
        status: toApiValue(filters.status),
        search: filters.search || undefined,
        page,
      }),
  });

  // A `?page=` pointing past the end — a stale link, or a filter applied from a
  // card while deep in the list — would render an empty table over a non-empty
  // result set. Fall back to the last real page instead.
  useEffect(() => {
    if (!data || data.totalPages < 1 || page <= data.totalPages) return;
    replaceQuery(serializeIssueFilters(filters, data.totalPages));
  }, [data, page, filters, replaceQuery]);

  const filtersActive = hasActiveIssueFilters(filters);


  const columns = useMemo<ColumnDef<SecurityIssue>[]>(
    () => [
      {
        accessorKey: 'severity',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Severity" />,
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" />,
        size: 110,
      },
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issue" />,
        cell: ({ row }) => (
          <Link href={`/issues/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'endpoint',
        meta: { className: 'hidden lg:table-cell' },
        header: 'Endpoint',
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-mono text-xs">
            <MethodBadge method={row.original.method} />
            {row.original.normalizedRoute}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        size: 130,
      },
      {
        // The number that makes deduplication visible: one row here can
        // represent many detections across many scans.
        accessorKey: 'occurrenceCount',
        meta: { className: 'hidden md:table-cell' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Occurrences" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.occurrenceCount}</span>,
        size: 110,
      },
      {
        accessorKey: 'lastSeenAt',
        meta: { className: 'hidden xl:table-cell' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last seen" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDate(row.original.lastSeenAt)}</span>
        ),
        size: 140,
      },
    ],
    [],
  );

  const issues = data?.data ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="Issues"
        description="Vulnerabilities that persist across scans. Each appears once, however many times it has been detected."
      />

      <IssueStatsStrip />

      <IssueFilters value={filters} onChange={applyFilters} />

      {isError ? (
        <EmptyState icon={IconBug} title="Could not load issues" description="Try again in a moment." />
      ) : isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : issues.length === 0 ? (
        <EmptyState
          icon={IconBug}
          title={filtersActive ? 'No issues match these filters' : 'No issues yet'}
          description={
            filtersActive
              ? 'Clear the filters to see all issues.'
              : 'Run a scan on a project to start detecting vulnerabilities.'
          }
          action={
            filtersActive ? (
              <Button variant="outline" size="sm" onClick={() => applyFilters(EMPTY_ISSUE_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* The toolbar's own search is hidden: search now lives in the filter
              row above, where it queries every page instead of the loaded one. */}
          <DataTable columns={columns} data={issues} hideToolbar />

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.page} of {data.totalPages} · {data.total} issues
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => goToPage(page - 1)}>
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
