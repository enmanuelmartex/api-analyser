'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowLeft,
  IconDownload,
  IconFileAnalytics,
  IconLoader2,
  IconRefresh,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { reportsApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Report } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ReportMetadata } from '@/components/reports/report-metadata';
import { ReportAssessmentSummary } from '@/components/reports/report-assessment-summary';
import { ReportFindingsList } from '@/components/reports/report-findings-list';
import { ReportFormatActions } from '@/components/reports/report-format-actions';
import { useCurrentUser } from '@/hooks/use-current-user';

export default function ReportDetailPage() {
  const { canWrite } = useCurrentUser();
  const { reportId } = useParams<{ reportId: string }>();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const query = useQuery<Report>({
    queryKey: ['reports', reportId],
    queryFn: () => reportsApi.get(reportId),
    enabled: Boolean(reportId),
  });

  /**
   * Downloads THIS report.
   *
   * Hits the download endpoint, which streams the artifact stored when the
   * report was issued. It creates no record, does not move `generatedAt`, and
   * does not re-read the current findings.
   */
  const download = useMutation({
    mutationFn: () => reportsApi.download(reportId),
    onMutate: () => setDownloading(true),
    onError: () => toast.error('The existing report could not be downloaded.'),
    onSettled: () => setDownloading(false),
  });

  const regenerate = useMutation({
    mutationFn: () => {
      const report = query.data!;
      return reportsApi.generate(report.assessmentId, report.format, report.type, {
        regenerate: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      toast.success('A new report version was generated');
    },
    onError: () =>
      toast.error('Report generation failed.', {
        action: { label: 'Retry generation', onClick: () => regenerate.mutate() },
      }),
  });

  if (query.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-6 h-28 w-full" />
        <Skeleton className="mt-4 h-56 w-full" />
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <EmptyState
          icon={IconFileAnalytics}
          title="Report not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <Button asChild variant="outline">
              <Link href="/reports">Back to Reports</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const report = query.data;
  const summary = report.assessment?.summary;
  const findings = report.assessment?.occurrences ?? [];
  const formats = report.formats ?? [];
  // Other formats that exist and can therefore be offered as a download here.
  const otherDownloadable = formats.filter(
    (entry) => entry.status === 'AVAILABLE' && entry.format !== report.format,
  );

  return (
    <PageContainer>
      <PageHeader
        title={report.title}
        description={`${report.assessment?.project?.name ?? 'Unknown project'} · ${report.type.charAt(0)}${report.type.slice(1).toLowerCase()} · ${report.format} · generated ${formatDate(report.generatedAt)}`}
        breadcrumb={
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-3" />
            Back to Reports
          </Link>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/assessments/${report.assessmentId}`}>View assessment</Link>
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                {/* A span keeps the tooltip working while the button is disabled. */}
                <span>
                  <Button
                    disabled={!report.isDownloadable || downloading}
                    onClick={() => download.mutate()}
                    aria-label={`Download the existing ${report.format} report`}
                  >
                    {downloading ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : (
                      <IconDownload className="size-4" />
                    )}
                    {downloading ? 'Preparing…' : `Download ${report.format}`}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {report.isDownloadable
                  ? 'Downloads the stored file. No new report is created.'
                  : 'This report has no stored file. Generate it below.'}
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More report actions">
                  ⋯
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {otherDownloadable.map((entry) => (
                  <DropdownMenuItem
                    key={entry.format}
                    onSelect={(event) => {
                      event.preventDefault();
                      if (entry.reportId) {
                        reportsApi
                          .download(entry.reportId)
                          .catch(() => toast.error('The existing report could not be downloaded.'));
                      }
                    }}
                  >
                    <IconDownload className="size-3.5" />
                    Download {entry.format}
                  </DropdownMenuItem>
                ))}
                {canWrite && (
                  <DropdownMenuItem
                    disabled={regenerate.isPending}
                    onSelect={(event) => {
                      event.preventDefault();
                      regenerate.mutate();
                    }}
                  >
                    {regenerate.isPending ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="size-3.5" />
                    )}
                    Regenerate {report.format}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/*
        8/4 split. The summary and the findings are what the page is about, so
        they get the reading column; identity and per-format actions are
        reference material and sit in the rail. Previously the summary spanned
        the full width, which spread four short values across ~1200px and left
        the card mostly empty.

        On mobile the grid collapses to one column in source order: summary,
        findings, metadata, formats.
      */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <ReportAssessmentSummary summary={summary} />
          <ReportFindingsList findings={findings} />
        </div>

        <aside className="space-y-4 lg:col-span-4">
          <ReportMetadata report={report} />
          <ReportFormatActions
            assessmentId={report.assessmentId}
            type={report.type}
            formats={formats}
            primaryFormat={report.format}
          />
        </aside>
      </div>
    </PageContainer>
  );
}
