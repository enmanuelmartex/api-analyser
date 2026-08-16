'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconArrowLeft, IconBug, IconCalendarClock, IconChartBar, IconDownload, IconFileReport, IconPlayerStop, IconSparkles, IconTerminal2 } from '@tabler/icons-react';
import { toast } from 'sonner';
import { assessmentsApi, reportsApi, scoringApi } from '@/lib/api';
import type { AiAnalysisMeta, Assessment, AssessmentScore, ScanProgress } from '@/types';
import { AI_SETTINGS_HREF, useAiStatus } from '@/hooks/use-ai-status';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SeverityBadge } from '@/components/security/severity-badge';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { ScoreDisplay } from '@/components/security/score-display';
import { ScoreBreakdown } from '@/components/security/score-breakdown';
import { ScanComparison } from '@/components/assessments/scan-comparison';
import { AssessmentProgress } from '@/components/assessments/assessment-progress';
import { DeleteConfirmationDialog } from '@/components/shared/delete-confirmation-dialog';
import { formatDate, formatDuration } from '@/lib/utils';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export default function AssessmentDetailPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState<string>();
  /*
   * The latest live message, e.g. "Running Mass Assignment...".
   *
   * Kept beside the cache rather than inside it: `currentStep` is a persisted
   * column holding the stage name, and writing the prose message into it made
   * the cached row disagree with the database — so a refresh changed what the
   * page said even though nothing had happened.
   */
  const [liveMessage, setLiveMessage] = useState<string>();
  const query = useQuery<Assessment>({
    queryKey: ['assessments', assessmentId],
    queryFn: () => assessmentsApi.get(assessmentId),
    enabled: Boolean(assessmentId),
    refetchInterval: (state) => TERMINAL.has(state.state.data?.status ?? '') ? false : 3000,
  });

  useEffect(() => {
    const token = window.localStorage.getItem('api_analyser_token');
    if (!assessmentId || !token || TERMINAL.has(query.data?.status ?? '')) return;
    const stream = assessmentsApi.streamProgress(assessmentId, token);
    stream.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data) as ScanProgress;
        if (update.message) setLiveMessage(update.message);
        queryClient.setQueryData<Assessment>(['assessments', assessmentId], (current) => current ? {
          ...current,
          progress: update.progress ?? current.progress,
          // The stage name, matching the persisted column. The prose message
          // goes to `liveMessage` instead.
          currentStep: update.step ?? current.currentStep,
        } : current);
        if (update.completed || update.error) {
          stream.close();
          queryClient.invalidateQueries({ queryKey: ['assessments', assessmentId] });
        }
      } catch {
        // Polling remains active when an event cannot be decoded.
      }
    };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [assessmentId, query.data?.status, queryClient]);

  const isTerminal = TERMINAL.has(query.data?.status ?? '');

  // Declared before the early returns below: hook order must not depend on
  // whether the scan happens to have loaded yet.
  const scoreQuery = useQuery<AssessmentScore>({
    queryKey: ['assessment-score', assessmentId],
    queryFn: () => scoringApi.assessmentScore(assessmentId),
    enabled: Boolean(assessmentId) && isTerminal,
  });

  const cancelScan = useMutation({
    mutationFn: () => assessmentsApi.cancel(assessmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
      queryClient.invalidateQueries({ queryKey: ['assessments', assessmentId] });
      toast.success('Scan cancelled');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Could not cancel this scan');
    },
  });

  if (query.isLoading) return <PageContainer><Skeleton className="h-9 w-72" /><Skeleton className="mt-6 h-72 w-full" /></PageContainer>;
  if (query.isError || !query.data) return <PageContainer><EmptyState icon={IconBug} title="Assessment not found" description="It may have been deleted or you may not have access." action={<Button asChild variant="outline"><Link href="/assessments">Back to assessments</Link></Button>} /></PageContainer>;

  const assessment = query.data;
  const running = !TERMINAL.has(assessment.status);
  const summary = assessment.summary;
  const ai = summary?.aiStatus;

  /**
   * Exports a format from this scan.
   *
   * Two steps on purpose. `generate` is idempotent — it returns the existing
   * report when the format was already produced — and only then does `download`
   * fetch the artifact. Previously a single call both created a Report row and
   * streamed the file, so exporting the same format twice left two rows behind.
   */
  const exportReport = async (format: 'PDF' | 'HTML' | 'JSON' | 'SARIF' | 'MARKDOWN') => {
    setExporting(format);
    try {
      const { report, created } = await reportsApi.generate(assessment.id, format, 'TECHNICAL');
      await reportsApi.download(report.id);
      queryClient.invalidateQueries({ queryKey: ['assessments', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      toast.success(created ? `${format} report generated and downloaded` : `${format} report downloaded`);
    } catch {
      toast.error(`Could not export ${format}`);
    } finally {
      setExporting(undefined);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={`Assessment ${assessment.id.slice(0, 8)}`}
        description={`${assessment.project?.name ?? 'Project'} · ${formatDate(assessment.createdAt)}`}
        breadcrumb={<Link href="/assessments" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconArrowLeft className="size-3" />Scans</Link>}
        actions={
          <>
            <StatusBadge status={assessment.status} />
            {/*
              Cancel was implemented on the server — it removes the BullMQ job
              and marks the scan CANCELLED — but nothing in the UI ever called
              it, so a stuck scan could not be stopped from the product.
            */}
            {running && (
              <DeleteConfirmationDialog
                title="Cancel this scan?"
                description="The scan stops where it is. Findings already persisted are kept, but the scan will not produce a score or a report."
                confirmLabel="Cancel scan"
                /* Not the default "Cancel": next to "Cancel scan" it would be
                   ambiguous which button aborts the scan. */
                cancelLabel="Keep running"
                deletingLabel="Cancelling…"
                isDeleting={cancelScan.isPending}
                onConfirm={() => cancelScan.mutateAsync()}
                trigger={
                  <Button variant="outline" className="text-destructive hover:text-destructive">
                    <IconPlayerStop className="size-4" />
                    Cancel scan
                  </Button>
                }
              />
            )}
            {assessment.project && <Button asChild variant="outline"><Link href={`/projects/${assessment.project.id}`}>Open project</Link></Button>}
          </>
        }
      />

      {/*
        Where this scan came from.

        A scheduled run is an ordinary assessment — same model, same worker,
        same findings — so nothing else on this page distinguishes it. Without
        this line, a scan that appeared at 02:00 has no explanation at all, and
        the operator's first question is "who ran this?".

        The schedule may have been deleted since; the scan outlives it, so the
        link is only rendered when the schedule is still there.
      */}
      {assessment.trigger === 'SCHEDULED' && (
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <IconCalendarClock className="size-4 shrink-0" />
          {assessment.schedule ? (
            <span>
              Triggered automatically by{' '}
              <Link
                href={`/scheduled-scans/${assessment.schedule.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {assessment.schedule.name}
              </Link>
            </span>
          ) : (
            <span>Triggered automatically by a scheduled scan that has since been deleted</span>
          )}
        </p>
      )}

      {/*
        The stage stepper replaced a lone percentage bar. Everything it renders
        comes from the worker — `status`, `progress` and `currentStep` are
        persisted on the assessment row, and `liveMessage` is the latest frame
        from the progress stream — so a reload mid-scan resumes at the same
        stage instead of restarting the display.
      */}
      <Card className={running ? 'border-primary/30' : undefined}>
        <CardContent className="pt-6">
          <AssessmentProgress
            status={assessment.status}
            progress={assessment.progress}
            currentStep={assessment.currentStep}
            message={liveMessage}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          The score is rendered with its status, not as a bare number.
          This card previously showed `securityScore ?? "—"` and dropped
          `scoreStatus` entirely, so a PROVISIONAL score — a real measurement
          over incomplete coverage — was presented exactly like a FINAL one.
          That is precisely the confusion the ScoreStatus enum exists to stop.
        */}
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Security score</CardDescription>
            <ScoreDisplay
              score={summary?.securityScore ?? null}
              status={(summary?.scoreStatus ?? 'UNAVAILABLE') as any}
              coveragePercent={summary?.coveragePercent ?? null}
              size="md"
            />
          </CardHeader>
        </Card>
        <Metric label="Endpoints tested" value={summary ? `${summary.testedEndpoints}/${summary.totalEndpoints}` : '—'} />
        <Metric label="Findings" value={summary?.totalFindings ?? assessment._count?.occurrences ?? '—'} />
        <Metric label="Duration" value={assessment.duration ? formatDuration(assessment.duration) : '—'} />
      </div>

      {/* Score explanation and comparison: both back existing, tested services
          that had no UI at all before this. */}
      {!running && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconChartBar className="size-4 text-primary" />
                Score breakdown
              </CardTitle>
              <CardDescription>Why this scan scored what it did.</CardDescription>
            </CardHeader>
            <CardContent>
              {scoreQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : scoreQuery.data ? (
                <ScoreBreakdown score={scoreQuery.data} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No score snapshot is available for this scan.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="min-w-0">
            <ScanComparison assessmentId={assessment.id} />
          </div>
        </div>
      )}

      {/* Grid items default to `min-width: auto`, meaning they refuse to shrink
          below their content's min-content width. `min-w-0` on both children is
          what allows the single mobile column to stay inside the viewport. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><IconBug className="size-4 text-primary" />Findings</CardTitle><CardDescription>Evidence captured by this immutable execution.</CardDescription></CardHeader><CardContent className="space-y-2">{assessment.occurrences?.length ? assessment.occurrences.map((finding) => <Link key={finding.id} href={`/issues/${finding.issueId}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-accent"><div className="min-w-0"><p className="truncate text-sm font-medium">{finding.titleSnapshot}</p><p className="truncate text-xs text-muted-foreground">{`${finding.methodSnapshot} ${finding.pathSnapshot}`}</p></div><SeverityBadge severity={finding.severitySnapshot} size="sm" /></Link>) : <EmptyState icon={IconBug} title={running ? 'Scanning for findings' : 'No findings detected'} compact />}</CardContent></Card>
        <div className="min-w-0 space-y-4">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconTerminal2 className="size-4 text-primary" />Execution</CardTitle></CardHeader><CardContent><dl className="space-y-2 text-xs"><Row label="Mode" value={assessment.config?.executionMode ?? '—'} /><Row label="Plugins" value={String(assessment.config?.resolvedPlugins?.length ?? 0)} /><Row label="AI analysis" value={assessment.config?.enableAiAnalysis ? 'Enabled' : 'Disabled'} /><Row label="Risk" value={summary?.riskLevel ?? '—'} /></dl></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconFileReport className="size-4 text-primary" />Reports</CardTitle></CardHeader><CardContent className="space-y-2">{assessment.reports?.length ? assessment.reports.map((report) => <Button key={report.id} asChild variant="outline" className="w-full justify-between"><Link href={`/reports/${report.id}`}><span className="truncate">{report.title}</span><Badge variant="secondary" className="shrink-0">{report.format}</Badge></Link></Button>) : <p className="text-sm text-muted-foreground">{running ? 'Generated after completion.' : 'No report artifact is available.'}</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconDownload className="size-4 text-primary" />Export</CardTitle><CardDescription>PDF is the primary report; machine-readable formats are also available.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2">{(['PDF', 'HTML', 'JSON', 'SARIF', 'MARKDOWN'] as const).map((format) => <Button key={format} variant={format === 'PDF' ? 'default' : 'outline'} size="sm" disabled={running || Boolean(exporting)} onClick={() => exportReport(format)}>{exporting === format ? 'Preparing…' : format}</Button>)}</CardContent></Card>
          <AiEnrichmentCard ai={ai} requested={Boolean(assessment.config?.enableAiAnalysis)} running={running} />
        </div>
      </div>
    </PageContainer>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) { return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>; }

/**
 * What AI enrichment did on this scan — and, when it did nothing, why.
 *
 * The metadata rows alone were technically complete and practically useless:
 * "Status: skipped / Details: No API key configured for openai" is a
 * configuration problem stated in the vocabulary of the process that hit it,
 * on the screen furthest from the setting that fixes it. A run requested with
 * enrichment that produced none now says so as a notice, names the cause, and
 * links an admin straight to the provider settings.
 *
 * The scan's own result is never in question here, so the notice says that
 * outright — enrichment is advisory, and its absence changes no finding.
 */
function AiEnrichmentCard({
  ai,
  requested,
  running,
}: {
  ai?: AiAnalysisMeta;
  requested: boolean;
  running: boolean;
}) {
  const status = ai?.status ?? (ai?.available ? 'completed' : 'skipped');
  const noProvider = Boolean(ai) && requested && status === 'skipped' && !ai?.available;
  const failed = status === 'failed';

  // Only fetched when there is something to act on, so an ordinary scan page
  // does not call `/ai/status` for a card nobody needs to read.
  const aiStatus = useAiStatus(noProvider || failed);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconSparkles className="size-4 text-ai" />
          AI enrichment
        </CardTitle>
        <CardDescription>
          {requested ? 'Requested for this execution.' : 'Not requested for this execution.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {(noProvider || failed) && (
          <div className="flex gap-2.5 rounded-md border border-severity-medium/20 bg-severity-medium/5 p-3">
            <IconAlertTriangle className="mt-0.5 size-4 flex-shrink-0 text-severity-medium" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {noProvider ? 'No AI provider was available for this scan' : 'The AI provider returned an error'}
              </p>
              <p className="mt-1 leading-5 text-muted-foreground">
                Every security check still ran and every finding below was recorded by the scanner —
                only the AI commentary is missing.
                {(ai?.reason || ai?.errorMessage) && (
                  <span className="mt-1 block break-words">
                    Reported reason: {ai?.reason || ai?.errorMessage}
                  </span>
                )}
              </p>
              {aiStatus.canConfigure ? (
                <Link
                  href={AI_SETTINGS_HREF}
                  className="mt-2 inline-block font-medium text-primary hover:underline"
                >
                  {noProvider ? 'Connect an AI provider →' : 'Check the provider connection →'}
                </Link>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  Ask an administrator to review the provider in Settings → AI.
                </p>
              )}
            </div>
          </div>
        )}

        {ai ? (
          <dl className="space-y-2">
            <Row label="Status" value={status} />
            <Row label="Provider" value={ai.provider || '—'} />
            <Row label="Model" value={ai.model || '—'} />
            <Row label="Findings enriched" value={String(ai.analyzed)} />
            <Row label="Tokens" value={ai.tokensUsed.toLocaleString()} />
            {(ai.reason || ai.errorMessage) && !noProvider && !failed && (
              <Row label="Details" value={ai.reason || ai.errorMessage || '—'} />
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground">
            {running ? 'AI runs after plugin analysis.' : 'No AI execution metadata was recorded.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
/**
 * A label/value pair.
 *
 * `min-w-0` plus `break-words` on the value is what keeps this row from setting
 * the width of everything around it. Values here are not all short enums: the AI
 * "Details" row carries provider error text ending in a long URL with no spaces,
 * whose min-content width is the entire string. Without a break opportunity that
 * measurement propagates up through the grid item and stretches the whole column
 * past the viewport, taking every sibling card with it.
 */
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right font-medium capitalize">{value}</dd></div>; }
