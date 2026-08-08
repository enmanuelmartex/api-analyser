'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { IconActivity, IconAlertTriangle, IconFolder, IconPlus, IconShield } from '@tabler/icons-react';
import { assessmentsApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/dashboard/metric-card';
import { OWASP_CATEGORIES } from '@/components/dashboard/owasp-categories';
import { RecentAssessmentsTable } from '@/components/dashboard/recent-assessments-table';
import type { DashboardStats } from '@/types';

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
const OwaspCoverageRadar = dynamic(() => chartsModule().then((m) => m.OwaspCoverageRadar), {
  ssr: false,
  loading: ChartFallback,
});

function aggregateOwaspCoverage(stats?: DashboardStats) {
  const totals: Record<string, number> = {};
  const assessments = stats?.recentAssessments ?? [];
  for (const category of OWASP_CATEGORIES) {
    const values = assessments
      .map((assessment) => assessment.summary?.owaspCoverage?.[category.id])
      .filter((value): value is number => typeof value === 'number');
    totals[category.id] = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
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
 * The heights match the real sections (`h-36` cards, `min-h-[420px]` charts), so
 * swapping placeholders for content shifts nothing.
 */
function DashboardSectionsSkeleton() {
  return <><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-full min-h-[420px] rounded-xl" />)}</div></>;
}

export default function DashboardPage() {
  const { data: stats, isLoading, isError } = useQuery<DashboardStats>({ queryKey: ['dashboard'], queryFn: assessmentsApi.dashboard, refetchInterval: 30000 });

  // Start fetching the chart chunk as soon as the route mounts rather than when
  // the charts first render. Without this the chunk request would queue behind
  // the dashboard API call instead of running alongside it, so the split would
  // trade hydration time for an equal wait later.
  useEffect(() => {
    void chartsModule();
  }, []);

  // Recomputed only when the assessment list changes, not on every 30s poll tick
  // — this walks all ten OWASP categories across every recent assessment.
  const owaspCoverage = useMemo(() => aggregateOwaspCoverage(stats), [stats]);

  const hasData = Boolean(stats?.totalAssessments);
  // Null means no project has a computable score. Rendering it as 0 would
  // claim the worst possible posture for a workspace that has simply not been
  // scanned yet.
  const securityScore = stats?.avgSecurityScore ?? null;

  return <PageContainer className="space-y-5 pb-10">
    <PageHeader title="Security Dashboard" description="Monitor your API security posture across all projects" className="mb-0" actions={<Button asChild><Link href="/projects/new"><IconPlus className="h-4 w-4" />New Project</Link></Button>} />
    {isError && <div role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Dashboard data could not be refreshed. Try again shortly.</div>}
    {isLoading ? <DashboardSectionsSkeleton /> : <>
    <section aria-label="Security metrics" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Security Score" value={securityScore === null ? '—' : String(securityScore)} suffix={securityScore === null ? undefined : '/100'} icon={<IconShield className="h-4 w-4" />} tone="muted" description={hasData ? 'Average across all assessments' : 'No assessments yet'} />
      <MetricCard label="Critical Findings" value={String(stats?.findings?.critical ?? 0)} icon={<IconAlertTriangle className="h-4 w-4" />} tone="muted" description="Require immediate attention" highlight={Boolean(stats?.findings?.critical)} />
      <MetricCard label="Projects" value={String(stats?.totalProjects ?? 0)} icon={<IconFolder className="h-4 w-4" />} tone="muted" description="Active API projects" />
      <MetricCard label="Assessments" value={String(stats?.totalAssessments ?? 0)} icon={<IconActivity className="h-4 w-4" />} tone="muted" description="Completed security scans" />
    </section>
    <section aria-label="Security analytics" className="grid auto-rows-fr grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
      <SecurityScoreChart trend={stats?.scoreTrend ?? []} yearAverage={stats?.scoreTrendAverage ?? null} />
      <FindingsSeverityChart trend={stats?.findingsTrend ?? []} previousTotal={stats?.findingsTrendPreviousTotal ?? 0} />
      <OwaspCoverageRadar coverage={owaspCoverage} />
    </section>
    <RecentAssessmentsTable assessments={(stats?.recentAssessments ?? []).slice(0, 3)} />
    </>}
  </PageContainer>;
}
