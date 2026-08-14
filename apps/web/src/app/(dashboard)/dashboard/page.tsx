'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { IconActivity, IconAlertTriangle, IconFolder, IconPlus, IconShield } from '@tabler/icons-react';
import { assessmentsApi, issuesApi } from '@/lib/api';
import { issuesHref } from '@/lib/issue-list';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard, MetricCardSkeleton } from '@/components/shared/metric-card';
import { RecentAssessmentsTable } from '@/components/dashboard/recent-assessments-table';
import { UpcomingScansCard } from '@/components/dashboard/upcoming-scans-card';
import type { DashboardStats, IssueStats } from '@/types';

/**
 * The three analytics charts are the only Recharts consumers on this route, and
 * Recharts is by far the heaviest dependency in the app. Because the dashboard
 * shell does not paint until the route's JavaScript has hydrated, every kilobyte
 * in the entry chunk is time the user spends looking at a spinner — so the charts
 * load as their own chunk instead.
 *
 * The placeholder reserves the same height the cards occupy (`min-h-[420px]`,
 * matching the Card in `dashboard-charts.tsx`), so splitting them out cannot
 * introduce layout shift.
 */
const chartsModule = () => import('@/components/dashboard/dashboard-charts');
const ChartFallback = () => <Skeleton className="h-full min-h-[420px] rounded-xl" />;

const SecurityScoreChart = dynamic(() => chartsModule().then((m) => m.SecurityScoreChart), {
  ssr: false,
  loading: ChartFallback,
});
const FindingsSeverityChart = dynamic(() => chartsModule().then((m) => m.FindingsSeverityChart), {
  ssr: false,
  loading: ChartFallback,
});
const OwaspIssuesRadar = dynamic(() => chartsModule().then((m) => m.OwaspIssuesRadar), {
  ssr: false,
  loading: ChartFallback,
});

/**
 * Open issues per OWASP category, keyed by canonical id.
 *
 * Read from the issue store rather than from `summary.owaspCoverage`. That
 * field counts findings *per scan*, so the radar previously had to either
 * average it — hiding a category that only the newest scan reported — or sum
 * it, counting one unfixed problem once per scan that re-detected it. Issues
 * are already deduplicated across scans, so neither distortion applies.
 */
function issuesByOwaspCategory(stats?: IssueStats) {
  const totals: Record<string, number> = {};
  for (const entry of stats?.byOwasp ?? []) {
    if (entry.owaspCategory) totals[entry.owaspCategory] = entry._count._all;
  }
  return totals;
}

/**
 * Placeholders for the data-dependent sections only.
 *
 * This used to stand in for the entire page, header included. That made the
 * `h1` — this route's LCP element — depend on the dashboard API call, so it
 * could not be server-rendered and did not paint until React had hydrated and
 * the request had come back. The header is static text; it renders immediately
 * and the skeletons cover just the parts that are genuinely still loading.
 *
 * The placeholders are the real components' own skeletons (`MetricCardSkeleton`)
 * and the charts' reserved height (`min-h-[420px]`), so swapping placeholders
 * for content shifts nothing.
 */
function DashboardSectionsSkeleton() {
  return <><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <MetricCardSkeleton key={index} />)}</div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-full min-h-[420px] rounded-xl" />)}</div></>;
}

export default function DashboardPage() {
  const { data: stats, isLoading, isError } = useQuery<DashboardStats>({ queryKey: ['dashboard'], queryFn: assessmentsApi.dashboard, refetchInterval: 30000 });

  // The radar's own source. Kept as a separate query rather than folded into
  // the dashboard payload so a failure here empties one card instead of the
  // whole page, and so it shares the cache with the Issues screen.
  const { data: issueStats } = useQuery<IssueStats>({ queryKey: ['issues', 'stats', 'all'], queryFn: () => issuesApi.stats(), refetchInterval: 30000 });

  // Start fetching the chart chunk as soon as the route mounts rather than when
  // the charts first render. Without this the chunk request would queue behind
  // the dashboard API call instead of running alongside it, so the split would
  // trade hydration time for an equal wait later.
  useEffect(() => {
    void chartsModule();
  }, []);

  const owaspIssues = useMemo(() => issuesByOwaspCategory(issueStats), [issueStats]);

  // Null means no project has a computable score. Rendering it as 0 would
  // claim the worst possible posture for a workspace that has simply not been
  // scanned yet.
  const securityScore = stats?.avgSecurityScore ?? null;
  const scoredProjects = stats?.scoredProjects ?? 0;
  const criticalFindings = stats?.findings?.critical ?? 0;

  return <PageContainer className="space-y-5 pb-10">
    <PageHeader title="Security Dashboard" description="Monitor your API security posture across all projects" className="mb-0" actions={<Button asChild><Link href="/projects/new"><IconPlus className="h-4 w-4" />New Project</Link></Button>} />
    {isError && <div role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Dashboard data could not be refreshed. Try again shortly.</div>}
    {isLoading ? <DashboardSectionsSkeleton /> : <>
    <section aria-label="Security metrics" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {/*
        Clicking a card opens the screen that explains it, filtered to what the
        number counts. The score's scanned population is completed scans; the
        critical count is open critical issues.
      */}
      <MetricCard
        title="Security Score"
        value={securityScore === null ? '—' : securityScore}
        suffix={securityScore === null ? undefined : '/100'}
        icon={<IconShield />}
        // Not "average across all assessments": the server averages ONE score
        // per project, taken from that project's most recent scorable scan.
        description={securityScore === null ? 'No project has a score yet' : `Latest score across ${scoredProjects} scored project${scoredProjects === 1 ? '' : 's'}`}
        href="/assessments?status=COMPLETED"
      />
      <MetricCard
        title="Critical Findings"
        value={criticalFindings}
        icon={<IconAlertTriangle />}
        accent="critical"
        description={criticalFindings ? 'Require immediate attention' : 'No critical findings detected'}
        href={issuesHref({ severity: 'CRITICAL' })}
      />
      <MetricCard
        title="Projects"
        value={stats?.totalProjects ?? 0}
        icon={<IconFolder />}
        description="Active API projects"
        href="/projects"
      />
      <MetricCard
        title="Scans"
        value={stats?.totalAssessments ?? 0}
        icon={<IconActivity />}
        // The total counts every scan, not only the completed ones — the old
        // "Completed security scans" line described a different number.
        description="Security scans run across all projects"
        href="/assessments"
      />
    </section>
    <section aria-label="Security analytics" className="grid auto-rows-fr grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
      <SecurityScoreChart trend={stats?.scoreTrend ?? []} yearAverage={stats?.scoreTrendAverage ?? null} />
      <FindingsSeverityChart trend={stats?.findingsTrend ?? []} previousTotal={stats?.findingsTrendPreviousTotal ?? 0} />
      <OwaspIssuesRadar issuesByCategory={owaspIssues} />
    </section>
    {/*
      Recent scans and upcoming ones, side by side: what has happened and what
      is about to. The upcoming card renders nothing when no schedule exists,
      so an installation that never uses scheduling keeps the full-width table
      it had before.
    */}
    <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <RecentAssessmentsTable assessments={(stats?.recentAssessments ?? []).slice(0, 3)} />
      <UpcomingScansCard />
    </section>
    </>}
  </PageContainer>;
}
