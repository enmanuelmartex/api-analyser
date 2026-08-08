'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { IconActivity } from '@tabler/icons-react';
import { assessmentsApi } from '@/lib/api';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { formatRelative, formatDuration, cn } from '@/lib/utils';
import type { Assessment } from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { AssessmentFilters } from '@/components/assessments/assessment-filters';
import {
  EMPTY_ASSESSMENT_FILTERS,
  filterAssessments,
  getDurationBound,
  hasActiveAssessmentFilters,
  parseAssessmentFilters,
  serializeAssessmentFilters,
  type AssessmentFilterState,
} from '@/lib/assessment-list';

function scoreClass(score: number) {
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-severity-medium';
  if (score >= 40) return 'text-severity-high';
  return 'text-severity-critical';
}

export default function AssessmentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: assessments, isLoading } = useQuery<Assessment[]>({
    queryKey: ['assessments'],
    queryFn: () => assessmentsApi.list(),
    refetchInterval: 10000,
  });

  const filters = useMemo(
    () => parseAssessmentFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const applyFilters = useCallback(
    (next: AssessmentFilterState) => {
      const query = serializeAssessmentFilters(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const visibleAssessments = useMemo(
    () => filterAssessments(assessments ?? [], filters),
    [assessments, filters],
  );
  const durationBound = useMemo(() => getDurationBound(assessments ?? []), [assessments]);
  const filtersActive = hasActiveAssessmentFilters(filters);

  const columns = useMemo<ColumnDef<Assessment>[]>(
    () => [
      {
        id: 'project',
        accessorFn: (row) => row.project?.name ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.original.project?.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{row.original.project?.baseUrl}</p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'score',
        accessorFn: (row) => row.summary?.securityScore ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score" />,
        cell: ({ row }) =>
          row.original.summary ? (
            <span className={cn('text-sm font-bold', scoreClass(row.original.summary.securityScore ?? 0))}>
              {row.original.summary.securityScore ?? "—"}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
        size: 80,
      },
      {
        // Counts come from the scan's real findings (findingCounts), not the
        // persisted summary counters, which can be zero for demo/old data.
        id: 'critical',
        meta: { className: 'hidden md:table-cell' },
        accessorFn: (row) => row.findingCounts?.critical ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Critical" />,
        cell: ({ row }) => <span className="text-sm font-bold text-destructive">{row.original.findingCounts?.critical ?? '—'}</span>,
        size: 80,
      },
      {
        id: 'high',
        meta: { className: 'hidden md:table-cell' },
        accessorFn: (row) => row.findingCounts?.high ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="High" />,
        cell: ({ row }) => <span className="text-sm font-bold text-severity-high">{row.original.findingCounts?.high ?? '—'}</span>,
        size: 80,
      },
      {
        id: 'total',
        meta: { className: 'hidden lg:table-cell' },
        accessorFn: (row) => row.findingCounts?.total ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
        cell: ({ row }) => <span className="text-sm text-foreground">{row.original.findingCounts?.total ?? '—'}</span>,
        size: 70,
      },
      {
        id: 'duration',
        meta: { className: 'hidden xl:table-cell' },
        accessorFn: (row) => row.duration ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.duration ? formatDuration(row.original.duration) : '—'}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        meta: { className: 'hidden lg:table-cell' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Started" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatRelative(row.original.createdAt)}</span>,
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageHeader title="Assessments" description="All security assessment runs across your projects" />

      <AssessmentFilters
        value={filters}
        onChange={applyFilters}
        durationBound={durationBound}
        className="mb-5"
      />

      <DataTable
        columns={columns}
        data={visibleAssessments}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/assessments/${row.id}`)}
        hideToolbar
        emptyState={
          <EmptyState
            icon={IconActivity}
            title={filtersActive ? 'No matching assessments' : 'No assessments yet'}
            description={
              filtersActive
                ? 'No runs match the current filters.'
                : 'Go to a project and run your first assessment.'
            }
            action={
              filtersActive ? (
                <Button variant="outline" size="sm" onClick={() => applyFilters(EMPTY_ASSESSMENT_FILTERS)}>
                  Clear filters
                </Button>
              ) : undefined
            }
            compact
          />
        }
      />
    </PageContainer>
  );
}
