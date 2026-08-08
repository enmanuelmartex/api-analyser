'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArrowLeft, IconBug, IconDownload, IconFileReport, IconSparkles, IconTerminal2 } from '@tabler/icons-react';
import { toast } from 'sonner';
import { assessmentsApi, reportsApi } from '@/lib/api';
import type { Assessment, ScanProgress } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SeverityBadge } from '@/components/security/severity-badge';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { formatDate, formatDuration } from '@/lib/utils';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export default function AssessmentDetailPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState<string>();
  const query = useQuery<Assessment>({
    queryKey: ['assessments', assessmentId],
    queryFn: () => assessmentsApi.get(assessmentId),
    enabled: Boolean(assessmentId),
    refetchInterval: (state) => TERMINAL.has(state.state.data?.status ?? '') ? false : 3000,
  });

  useEffect(() => {
    const token = window.localStorage.getItem('iasa_token');
    if (!assessmentId || !token || TERMINAL.has(query.data?.status ?? '')) return;
    const stream = assessmentsApi.streamProgress(assessmentId, token);
    stream.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data) as ScanProgress;
        queryClient.setQueryData<Assessment>(['assessments', assessmentId], (current) => current ? {
          ...current,
          progress: update.progress ?? current.progress,
          currentStep: update.message ?? update.step ?? current.currentStep,
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
        breadcrumb={<Link href="/assessments" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconArrowLeft className="size-3" />Assessments</Link>}
        actions={<><StatusBadge status={assessment.status} />{assessment.project && <Button asChild variant="outline"><Link href={`/projects/${assessment.project.id}`}>Open project</Link></Button>}</>}
      />

      <Card className={running ? 'border-primary/30' : undefined}>
        <CardHeader><CardTitle>{running ? 'Assessment in progress' : assessment.status === 'COMPLETED' ? 'Assessment completed' : 'Assessment stopped'}</CardTitle><CardDescription>{assessment.currentStep || (running ? 'Waiting for the scanner worker…' : 'The execution has reached a terminal state.')}</CardDescription></CardHeader>
        <CardContent><div className="flex items-center gap-3"><Progress value={assessment.progress} aria-label="Assessment progress" /><span className="w-12 text-right text-sm tabular-nums">{assessment.progress}%</span></div></CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Security score" value={summary ? `${summary.securityScore ?? "—"}/100` : '—'} />
        <Metric label="Endpoints tested" value={summary ? `${summary.testedEndpoints}/${summary.totalEndpoints}` : '—'} />
        <Metric label="Findings" value={summary?.totalFindings ?? assessment._count?.occurrences ?? '—'} />
        <Metric label="Duration" value={assessment.duration ? formatDuration(assessment.duration) : '—'} />
      </div>

      {/* Grid items default to `min-width: auto`, meaning they refuse to shrink
          below their content's min-content width. `min-w-0` on both children is
          what allows the single mobile column to stay inside the viewport. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><IconBug className="size-4 text-primary" />Findings</CardTitle><CardDescription>Evidence captured by this immutable execution.</CardDescription></CardHeader><CardContent className="space-y-2">{assessment.occurrences?.length ? assessment.occurrences.map((finding) => <Link key={finding.id} href={`/issues/${finding.issueId}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-accent"><div className="min-w-0"><p className="truncate text-sm font-medium">{finding.titleSnapshot}</p><p className="truncate text-xs text-muted-foreground">{`${finding.methodSnapshot} ${finding.pathSnapshot}`}</p></div><SeverityBadge severity={finding.severitySnapshot} size="sm" /></Link>) : <EmptyState icon={IconBug} title={running ? 'Scanning for findings' : 'No findings detected'} compact />}</CardContent></Card>
        <div className="min-w-0 space-y-4">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconTerminal2 className="size-4 text-primary" />Execution</CardTitle></CardHeader><CardContent><dl className="space-y-2 text-xs"><Row label="Mode" value={assessment.config?.executionMode ?? '—'} /><Row label="Plugins" value={String(assessment.config?.resolvedPlugins?.length ?? 0)} /><Row label="AI analysis" value={assessment.config?.enableAiAnalysis ? 'Enabled' : 'Disabled'} /><Row label="Risk" value={summary?.riskLevel ?? '—'} /></dl></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconFileReport className="size-4 text-primary" />Reports</CardTitle></CardHeader><CardContent className="space-y-2">{assessment.reports?.length ? assessment.reports.map((report) => <Button key={report.id} asChild variant="outline" className="w-full justify-between"><Link href={`/reports/${report.id}`}><span className="truncate">{report.title}</span><Badge variant="secondary" className="shrink-0">{report.format}</Badge></Link></Button>) : <p className="text-sm text-muted-foreground">{running ? 'Generated after completion.' : 'No report artifact is available.'}</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconDownload className="size-4 text-primary" />Export</CardTitle><CardDescription>PDF is the primary report; machine-readable formats are also available.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2">{(['PDF', 'HTML', 'JSON', 'SARIF', 'MARKDOWN'] as const).map((format) => <Button key={format} variant={format === 'PDF' ? 'default' : 'outline'} size="sm" disabled={running || Boolean(exporting)} onClick={() => exportReport(format)}>{exporting === format ? 'Preparing…' : format}</Button>)}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><IconSparkles className="size-4 text-primary" />AI enrichment</CardTitle><CardDescription>{assessment.config?.enableAiAnalysis ? 'Requested for this execution.' : 'Disabled for this execution.'}</CardDescription></CardHeader><CardContent className="text-xs">{ai ? <dl className="space-y-2"><Row label="Status" value={ai.status ?? (ai.available ? 'completed' : 'skipped')} /><Row label="Provider" value={ai.provider || '—'} /><Row label="Model" value={ai.model || '—'} /><Row label="Findings enriched" value={String(ai.analyzed)} /><Row label="Tokens" value={ai.tokensUsed.toLocaleString()} />{(ai.reason || ai.errorMessage) && <Row label="Details" value={ai.reason || ai.errorMessage || '—'} />}</dl> : <p className="text-muted-foreground">{running ? 'AI runs after plugin analysis.' : 'No AI execution metadata was recorded.'}</p>}</CardContent></Card>
        </div>
      </div>
    </PageContainer>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) { return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>; }
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
