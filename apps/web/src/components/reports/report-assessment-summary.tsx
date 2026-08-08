'use client';

import type { AssessmentSummary } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const SEVERITIES = [
  { key: 'criticalCount', label: 'Critical', className: 'text-severity-critical' },
  { key: 'highCount', label: 'High', className: 'text-severity-high' },
  { key: 'mediumCount', label: 'Medium', className: 'text-severity-medium' },
  { key: 'lowCount', label: 'Low', className: 'text-severity-low' },
  { key: 'infoCount', label: 'Info', className: 'text-muted-foreground' },
] as const;

function scoreClass(score: number | null) {
  if (score === null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-severity-medium';
  if (score >= 40) return 'text-severity-high';
  return 'text-severity-critical';
}

/**
 * The scan results this report describes.
 *
 * Every figure is read from the summary snapshot stored with the assessment —
 * the numbers the report was issued with — never recomputed against today's
 * findings. A report is a statement about a moment; re-deriving it would let a
 * historical document change after the fact.
 */
export function ReportAssessmentSummary({ summary }: { summary?: AssessmentSummary }) {
  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assessment summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No summary was stored with this assessment.
          </p>
        </CardContent>
      </Card>
    );
  }

  const score = summary.securityScore ?? null;
  const provisional = summary.scoreStatus !== 'FINAL';

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle>Assessment summary</CardTitle>
          <CardDescription>Results as recorded when this report was issued.</CardDescription>
        </div>
        {provisional && (
          <Badge variant="neutral" className="shrink-0">
            {summary.scoreStatus === 'PROVISIONAL' ? 'Provisional score' : 'No score'}
          </Badge>
        )}
      </CardHeader>

      {/*
        Tight column gaps on purpose. Four values spread across the full page
        width read as four unrelated numbers; grouped, they read as one summary.
      */}
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          <Figure
            label="Security score"
            value={score === null ? '—' : String(Math.round(score))}
            suffix={score === null ? undefined : '/100'}
            className={scoreClass(score)}
          />
          <Figure
            label="Endpoints tested"
            value={`${summary.testedEndpoints}`}
            suffix={`/${summary.totalEndpoints}`}
          />
          <Figure label="Findings" value={`${summary.totalFindings}`} />
          <Figure label="Risk level" value={summary.riskLevel ?? '—'} className="capitalize" />
        </div>

        <Separator />

        {/* The severity split is here and nowhere else on the page — the
            findings list below shows the items, not their totals again. */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5">
          {SEVERITIES.map(({ key, label, className }) => (
            <div key={key}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('mt-0.5 text-lg font-medium tabular-nums tracking-tight', className)}>
                {summary[key] ?? 0}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  suffix,
  className,
}: {
  label: string;
  value: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-0.5">
        <span className={cn('text-2xl font-medium tracking-tight tabular-nums', className)}>
          {value}
        </span>
        {suffix && <span className="text-sm text-muted-foreground tabular-nums">{suffix}</span>}
      </p>
    </div>
  );
}
