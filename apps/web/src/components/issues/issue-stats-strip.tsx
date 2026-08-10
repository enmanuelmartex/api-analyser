'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { issuesApi } from '@/lib/api';
import type { IssueStats } from '@/types';

/**
 * Aggregate counts above the issue list.
 *
 * `GET /issues/stats` was implemented and had no consumer, so the list gave no
 * sense of scale: a user paging through twenty rows could not tell whether they
 * were looking at twenty issues or two thousand, nor how many were critical.
 *
 * Counts are server-side aggregates over the whole result set, not over the
 * current page — which is the reason to call this endpoint rather than counting
 * the rows on screen.
 */

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: 'text-severity-critical',
  HIGH: 'text-severity-high',
  MEDIUM: 'text-severity-medium',
  LOW: 'text-severity-low',
  INFO: 'text-severity-info',
};

export function IssueStatsStrip({
  projectId,
  className,
}: {
  projectId?: string;
  className?: string;
}) {
  const { data, isLoading, isError } = useQuery<IssueStats>({
    queryKey: ['issue-stats', projectId ?? 'all'],
    queryFn: () => issuesApi.stats(projectId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7', className)}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  // Stats are supplementary; the list below still works without them, so a
  // failure here is silent rather than an error banner over the whole page.
  if (isError || !data) return null;

  const bySeverity = new Map(data.bySeverity.map((row) => [row.severity, row._count._all]));

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7', className)}>
      <StatTile label="Total" value={data.total} />
      <StatTile label="Open" value={data.open} emphasis={data.open > 0} />
      {SEVERITY_ORDER.map((severity) => (
        <StatTile
          key={severity}
          label={severity.charAt(0) + severity.slice(1).toLowerCase()}
          value={bySeverity.get(severity) ?? 0}
          toneClass={SEVERITY_CLASS[severity]}
          hint="open"
        />
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  toneClass,
  emphasis,
  hint,
}: {
  label: string;
  value: number;
  toneClass?: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-muted-foreground/60">{hint}</span>}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold tabular-nums',
          value === 0 ? 'text-muted-foreground' : (toneClass ?? 'text-foreground'),
          emphasis && value > 0 && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}
