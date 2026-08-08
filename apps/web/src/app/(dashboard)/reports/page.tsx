'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowRight,
  IconChartBar,
  IconShield,
} from '@tabler/icons-react';
import { reportsApi } from '@/lib/api';
import type { Report, ReportStats } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReportMetricCard } from '@/components/reports/report-metric-card';
import { VulnerabilityTrendChart } from '@/components/reports/vulnerability-trend-chart';
import { ReportsTable } from '@/components/reports/reports-table';

const TYPE_LABELS: Record<string, string> = {
  EXECUTIVE: 'Executive',
  TECHNICAL: 'Technical',
  COMPLIANCE: 'Compliance',
  DEVELOPER: 'Developer',
};

const FORMATS = ['PDF', 'HTML', 'MARKDOWN', 'JSON', 'SARIF'];

function scoreClass(score: number | null) {
  if (score === null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-severity-medium';
  if (score >= 40) return 'text-severity-high';
  return 'text-severity-critical';
}

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters live in the URL so a filtered view is shareable and survives a
  // reload. Local state would be a second copy of the same thing.
  const formatFilter = searchParams.get('format') ?? '';
  const typeFilter = searchParams.get('type') ?? '';

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(params.size ? `/reports?${params}` : '/reports', { scroll: false });
    },
    [router, searchParams],
  );

  const stats = useQuery<ReportStats>({
    queryKey: ['reports-stats'],
    queryFn: reportsApi.stats,
    staleTime: 60_000,
  });

  const reports = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: () => reportsApi.list(),
    staleTime: 30_000,
  });

  const filtered = useMemo(
    () =>
      (reports.data ?? []).filter((report) => {
        if (formatFilter && report.format !== formatFilter) return false;
        if (typeFilter && report.type !== typeFilter) return false;
        return true;
      }),
    [reports.data, formatFilter, typeFilter],
  );

  const isFiltered = Boolean(formatFilter || typeFilter);
  const data = stats.data;

  /**
   * Score movement between the last 30 days and the 30 before them.
   *
   * Shown in POINTS: a score is already 0–100, so "+8 pts" is unambiguous where
   * a percentage of a score invites confusion with the score itself. Here a
   * RISE is the good outcome, so `up` maps to the positive tone — the opposite
   * of the findings delta on the chart, which is why the two are computed
   * separately rather than sharing a helper.
   *
   * Null when either window has no scored assessment: the card then says so
   * instead of showing a badge against an invented baseline.
   */
  const scoreDelta = data?.averageScoreDelta
    ? {
        label: `${data.averageScoreDelta.deltaPoints > 0 ? '+' : ''}${data.averageScoreDelta.deltaPoints} pts`,
        direction: data.averageScoreDelta.direction,
        tone:
          data.averageScoreDelta.direction === 'up'
            ? ('positive' as const)
            : data.averageScoreDelta.direction === 'down'
              ? ('negative' as const)
              : ('neutral' as const),
      }
    : null;

  if (reports.isError || stats.isError) {
    return (
      <PageContainer>
        <PageHeader title="Reports" description="Security assessment history and vulnerability intelligence" />
        <EmptyState
          icon={IconAlertTriangle}
          title="Unable to load reports"
          description="The reports service could not be reached."
          action={
            <Button
              variant="outline"
              onClick={() => {
                reports.refetch();
                stats.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Security assessment history and vulnerability intelligence"
        actions={
          <Button asChild variant="outline">
            <Link href="/assessments">
              <IconActivity className="h-4 w-4" />
              Run new scan
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />

      {/*
        Five metrics, each answering a different question about REPORTS.
        The eight-card row this replaces mixed platform-wide totals (Projects,
        Scans) with per-severity counts already shown on the Dashboard, and its
        severity figures were multiplied by the number of formats each scan was
        exported to. Everything here is scoped to reported scans and counted
        once per scan.
      */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <ReportMetricCard
          label="Average assessment score"
          value={data?.averageAssessmentScore == null ? '—' : String(data.averageAssessmentScore)}
          suffix={data?.averageAssessmentScore == null ? undefined : '/100'}
          valueClassName={scoreClass(data?.averageAssessmentScore ?? null)}
          delta={scoreDelta}
          context={
            !data?.scoredAssessmentsInAverage
              ? 'No reported scan produced a score'
              : data.averageScoreDelta
                ? `Vs previous ${data.trendWindowDays} days: ${data.averageScoreDelta.previousAverage}/100`
                : `Across ${data.scoredAssessmentsInAverage} completed scan${data.scoredAssessmentsInAverage === 1 ? '' : 's'} with reports · no previous period data`
          }
          loading={stats.isLoading}
        />
        {/* "Artifacts", not "reports": with one row per format, a scan exported
            four ways is four rows. Calling that "4 reports generated" would
            contradict the single row the table shows per format. */}
        <ReportMetricCard
          label="Report artifacts"
          value={`${data?.activeReportArtifacts ?? 0}`}
          context={
            data
              ? `${data.activeReportArtifacts} active` +
                (data.supersededReportArtifacts > 0
                  ? ` · ${data.supersededReportArtifacts} superseded`
                  : '') +
                ` · ${data.activeArtifactsLast30Days} in last ${data.trendWindowDays}d`
              : undefined
          }
          loading={stats.isLoading}
        />
        <ReportMetricCard
          label="Projects covered"
          value={`${data?.distinctProjectsCovered ?? 0}`}
          context={
            data
              ? `Of ${data.totalActiveProjects} active project${data.totalActiveProjects === 1 ? '' : 's'}`
              : undefined
          }
          loading={stats.isLoading}
        />
        <ReportMetricCard
          label="Scans with reports"
          value={`${data?.distinctAssessmentsWithReports ?? 0}`}
          context={
            data
              ? `Of ${data.totalCompletedAssessments} completed scan${data.totalCompletedAssessments === 1 ? '' : 's'}`
              : undefined
          }
          loading={stats.isLoading}
        />
        {/* Historical findings from reported scans — deliberately not the same
            population as the Issues page, which counts currently-open issues. */}
        <ReportMetricCard
          label="Critical + High included"
          value={`${data?.criticalHighFindingsIncluded ?? 0}`}
          valueClassName={data?.criticalHighFindingsIncluded ? 'text-severity-critical' : undefined}
          context={
            data
              ? `${data.criticalFindingsIncluded} critical · ${data.highFindingsIncluded} high · ${data.totalFindingsIncluded} total`
              : undefined
          }
          loading={stats.isLoading}
        />
      </div>

      <div className="mb-4">
        <VulnerabilityTrendChart
          trend={data?.vulnerabilityTrend ?? []}
          delta={data?.vulnerabilityTrendDelta ?? null}
          windowDays={data?.trendWindowDays ?? 30}
          loading={stats.isLoading}
        />
      </div>

      <ReportsTable
        reports={filtered}
        isLoading={reports.isLoading}
        toolbarFilters={
          <>
            <Select
              value={formatFilter || 'all'}
              onValueChange={(value) => setFilter('format', value === 'all' ? '' : value)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by format">
                <SelectValue placeholder="Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All formats</SelectItem>
                {FORMATS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {format}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={typeFilter || 'all'}
              onValueChange={(value) => setFilter('type', value === 'all' ? '' : value)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by report type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          isFiltered && reports.data?.length ? (
            <EmptyState
              icon={IconChartBar}
              title="No reports match these filters"
              description="Try a different format or report type."
              action={
                <Button variant="outline" size="sm" onClick={() => router.replace('/reports', { scroll: false })}>
                  Clear filters
                </Button>
              }
              compact
            />
          ) : (
            <EmptyState
              icon={IconChartBar}
              title="No reports yet"
              description="Run a security scan to generate your first report."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/projects">
                    <IconShield className="h-3.5 w-3.5" />
                    Go to Projects
                  </Link>
                </Button>
              }
              compact
            />
          )
        }
      />
    </PageContainer>
  );
}
