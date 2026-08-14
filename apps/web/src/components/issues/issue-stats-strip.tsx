'use client';

import { useQuery } from '@tanstack/react-query';
import { IconInbox } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { issuesApi } from '@/lib/api';
import { issuesHref } from '@/lib/issue-list';
import type { IssueStats, Severity } from '@/types';
import { MetricCard, MetricCardSkeleton, type MetricAccent } from '@/components/shared/metric-card';
import { SEVERITY_META, SEVERITY_ORDER } from '@/components/security/severity-badge';

/**
 * Aggregate counts above the issue list, each one a link into the list it
 * summarises.
 *
 * `GET /issues/stats` was implemented and had no consumer, so the list gave no
 * sense of scale: a user paging through twenty rows could not tell whether they
 * were looking at twenty issues or two thousand, nor how many were critical.
 *
 * Counts are server-side aggregates over the whole result set, not over the
 * current page — which is the reason to call this endpoint rather than counting
 * the rows on screen. The per-severity figures count issues that are still
 * exposed (open, acknowledged or accepted risk); the card that links to a
 * severity therefore opens a slightly wider view, since the list shows every
 * status for that severity. Said plainly in each description rather than left
 * for the reader to discover.
 */

const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6';

const SEVERITY_ACCENT: Record<Severity, MetricAccent> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

export function IssueStatsStrip({
  projectId,
  className,
}: {
  projectId?: string;
  className?: string;
}) {
  // Same key the Dashboard uses for this endpoint, so the two screens share one
  // cached response instead of each fetching its own copy.
  const { data, isLoading, isError } = useQuery<IssueStats>({
    queryKey: ['issues', 'stats', projectId ?? 'all'],
    queryFn: () => issuesApi.stats(projectId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className={cn(GRID_CLASS, className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  // Stats are supplementary; the list below still works without them, so a
  // failure here is silent rather than an error banner over the whole page.
  if (isError || !data) return null;

  const bySeverity = new Map(data.bySeverity.map((row) => [row.severity, row._count._all]));
  // The strict OPEN count, not `data.open`: the card links to `status=OPEN`, so
  // it must show the number of rows that link produces. `data.open` — which also
  // counts acknowledged and accepted-risk issues — stays visible as context.
  const untriaged = data.byStatus.find((row) => row.status === 'OPEN')?._count._all ?? 0;

  return (
    <div className={cn(GRID_CLASS, className)}>
      <MetricCard
        title="Open"
        value={untriaged}
        icon={<IconInbox />}
        // Short by design: at six to a row these cards are narrow, and a
        // description that wraps to three lines sets the height of the strip.
        description={
          data.total === 0 ? 'No issues tracked yet' : `${data.open} of ${data.total} still exposed`
        }
        href={issuesHref({ status: 'OPEN' })}
      />

      {SEVERITY_ORDER.map((severity) => {
        const meta = SEVERITY_META[severity];
        const Icon = meta.icon;
        const value = bySeverity.get(severity) ?? 0;

        return (
          <MetricCard
            key={severity}
            title={meta.label}
            value={value}
            icon={<Icon />}
            accent={SEVERITY_ACCENT[severity]}
            description={
              value === 0
                ? `No open ${meta.label.toLowerCase()} findings`
                : `Open ${meta.label.toLowerCase()} findings`
            }
            href={issuesHref({ severity })}
          />
        );
      })}
    </div>
  );
}
