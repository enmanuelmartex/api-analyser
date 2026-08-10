'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { IconBug } from '@tabler/icons-react';
import { issuesApi } from '@/lib/api';
import type { IssueStatus, Paginated, SecurityIssue, Severity } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { IssueStatsStrip } from '@/components/issues/issue-stats-strip';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { SeverityBadge } from '@/components/security/severity-badge';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { MethodBadge } from '@/components/security/method-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const STATUSES: IssueStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'ACCEPTED_RISK',
  'FALSE_POSITIVE',
];

export default function IssuesPage() {
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<Paginated<SecurityIssue>>({
    queryKey: ['issues', severity, status, page],
    queryFn: () =>
      issuesApi.list({
        severity: severity || undefined,
        status: status || undefined,
        page,
      }),
  });


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

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton className="mb-6 h-16 w-80 max-w-full" />
        <Skeleton className="h-96 rounded-xl" />
      </PageContainer>
    );
  }

  const issues = data?.data ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="Issues"
        description="Vulnerabilities that persist across scans. Each appears once, however many times it has been detected."
      />

      <IssueStatsStrip />

      <div className="flex flex-wrap gap-2">
        <FilterGroup label="Severity" value={severity} options={SEVERITIES} onChange={(v) => { setSeverity(v); setPage(1); }} />
        <FilterGroup label="Status" value={status} options={STATUSES} onChange={(v) => { setStatus(v); setPage(1); }} />
      </div>

      {isError ? (
        <EmptyState icon={IconBug} title="Could not load issues" description="Try again in a moment." />
      ) : issues.length === 0 ? (
        <EmptyState
          icon={IconBug}
          title={severity || status ? 'No issues match these filters' : 'No issues yet'}
          description={
            severity || status
              ? 'Clear the filters to see all issues.'
              : 'Run a scan on a project to start detecting vulnerabilities.'
          }
        />
      ) : (
        <>
          <DataTable columns={columns} data={issues} />

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.page} of {data.totalPages} · {data.total} issues
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
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

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (_value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Button variant={value === '' ? 'default' : 'outline'} size="sm" onClick={() => onChange('')}>
        All
      </Button>
      {options.map((option) => (
        <Button
          key={option}
          variant={value === option ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(option)}
        >
          {option.replace(/_/g, ' ')}
        </Button>
      ))}
    </div>
  );
}
