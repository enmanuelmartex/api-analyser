'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconGitCompare,
  IconMinus,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import { cn, formatDate } from '@/lib/utils';
import { scoringApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityBadge } from '@/components/security/severity-badge';
import { ScoreCell } from '@/components/security/score-display';
import type {
  ComparisonCandidate,
  ComparisonChangeEntry,
  IssueChangeKind,
  ScanComparison as ScanComparisonResult,
} from '@/types';

/**
 * Scan A → Scan B.
 *
 * The comparison engine has existed and been tested for some time with no
 * screen behind it, which meant its most important property was invisible: it
 * distinguishes an issue that was *fixed* from one that merely *was not tested
 * again*. A diff that collapses those two into "resolved" tells a user their
 * API got safer when a check simply failed to run.
 *
 * The five outcomes are therefore rendered as five distinct groups, and the
 * two that are not good news — Not tested, Out of scope — are never folded
 * into the resolved count.
 */

const CHANGE_GROUPS: {
  kind: IssueChangeKind;
  label: string;
  description: string;
  tone: 'bad' | 'good' | 'neutral' | 'warn';
}[] = [
  {
    kind: 'NEW',
    label: 'New',
    description: 'Detected in this scan and not in the baseline.',
    tone: 'bad',
  },
  {
    kind: 'REOPENED',
    label: 'Reopened',
    description: 'Previously resolved, detected again.',
    tone: 'bad',
  },
  {
    kind: 'RESOLVED',
    label: 'Resolved',
    description: 'Absent now, and the check that finds it ran to completion.',
    tone: 'good',
  },
  {
    kind: 'PERSISTING',
    label: 'Still present',
    description: 'Detected in both scans.',
    tone: 'neutral',
  },
  {
    kind: 'NOT_TESTED',
    label: 'Not retested',
    description: 'The check did not complete, so absence proves nothing.',
    tone: 'warn',
  },
  {
    kind: 'OUT_OF_SCOPE',
    label: 'Out of scope',
    description: 'The check was not part of this scan at all.',
    tone: 'warn',
  },
];

export function ScanComparison({ assessmentId }: { assessmentId: string }) {
  const [baselineId, setBaselineId] = useState<string>('auto');

  const candidatesQuery = useQuery<ComparisonCandidate[]>({
    queryKey: ['comparison-candidates', assessmentId],
    queryFn: () => scoringApi.comparisonCandidates(assessmentId),
    enabled: Boolean(assessmentId),
  });

  const comparisonQuery = useQuery<ScanComparisonResult>({
    queryKey: ['comparison', assessmentId, baselineId],
    queryFn: () =>
      scoringApi.compare(assessmentId, baselineId === 'auto' ? undefined : baselineId),
    enabled: Boolean(assessmentId),
  });

  const candidates = candidatesQuery.data ?? [];

  if (comparisonQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconGitCompare className="size-4 text-primary" />
            Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  const comparison = comparisonQuery.data;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <IconGitCompare className="size-4 text-primary" />
            Comparison
          </CardTitle>
          <CardDescription>
            What changed against an earlier scan of the same project.
          </CardDescription>
        </div>

        {candidates.length > 0 && (
          <Select value={baselineId} onValueChange={setBaselineId}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-[260px]" aria-label="Baseline scan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Most recent earlier scan</SelectItem>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {formatDate(candidate.createdAt)}
                  {candidate.summary?.securityScore != null
                    ? ` · ${candidate.summary.securityScore}/100`
                    : ' · no score'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>

      <CardContent>
        {comparisonQuery.isError ? (
          <EmptyState
            icon={IconGitCompare}
            title="Comparison unavailable"
            description="The comparison could not be loaded. Scanner results for this scan are unaffected."
            compact
          />
        ) : !comparison || !comparison.baseline ? (
          <EmptyState
            icon={IconGitCompare}
            title="No baseline to compare against"
            description="Run another scan of this project to see what changed between them."
            compact
          />
        ) : (
          <ComparisonBody comparison={comparison} />
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonBody({ comparison }: { comparison: ScanComparisonResult }) {
  const { baseline, current, scoreDelta, coverageDelta, warnings, scopeChanges } = comparison;

  return (
    <div className="space-y-5">
      {/*
        Comparability is stated before any number. A partially comparable pair
        still produces a score delta, and that delta can be actively misleading
        if the two scans did not run the same checks.
      */}
      <ComparabilityNotice comparability={comparison.comparability} warnings={warnings} />

      <div className="grid gap-4 sm:grid-cols-2">
        <DeltaPanel
          label="Security score"
          before={baseline!.securityScore}
          beforeStatus={baseline!.scoreStatus}
          after={current.securityScore}
          afterStatus={current.scoreStatus}
          delta={scoreDelta}
          higherIsBetter
        />
        <DeltaPanel
          label="Coverage"
          before={baseline!.coveragePercent}
          after={current.coveragePercent}
          delta={coverageDelta}
          suffix="%"
          higherIsBetter
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {formatDate(baseline!.createdAt)} <IconArrowRight className="inline size-3" />{' '}
        {formatDate(current.createdAt)}
        {baseline!.scoreVersion &&
          current.scoreVersion &&
          baseline!.scoreVersion !== current.scoreVersion && (
            <span className="ml-2 text-severity-medium">
              Scored by different engine versions ({baseline!.scoreVersion} →{' '}
              {current.scoreVersion}); the delta is not strictly comparable.
            </span>
          )}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {CHANGE_GROUPS.map((group) => (
          <CountTile
            key={group.kind}
            label={group.label}
            count={comparison.changes[group.kind]?.length ?? 0}
            tone={group.tone}
          />
        ))}
      </div>

      {/*
        Optional chaining throughout: this renders a server payload, and a
        shape change should degrade to a hidden section rather than crash the
        whole scan page. `scopeChanges` is also null when there is no baseline.
      */}
      {(scopeChanges?.addedChecks?.length || scopeChanges?.removedChecks?.length) ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs">
          <p className="mb-1 font-medium text-foreground">Scope changed between scans</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {scopeChanges.addedChecks?.length > 0 && (
              <li>
                <span className="text-foreground">Added in this scan:</span>{' '}
                {scopeChanges.addedChecks.join(', ')} — findings from these have no baseline to
                compare against.
              </li>
            )}
            {scopeChanges.removedChecks?.length > 0 && (
              <li>
                <span className="text-foreground">Not run in this scan:</span>{' '}
                {scopeChanges.removedChecks.join(', ')} — their baseline findings are reported as
                not retested, never as resolved.
              </li>
            )}
            {scopeChanges.sharedChecks?.length > 0 && (
              <li className="text-muted-foreground/80">
                {scopeChanges.sharedChecks.length} check
                {scopeChanges.sharedChecks.length === 1 ? '' : 's'} ran in both scans.
              </li>
            )}
          </ul>
        </div>
      ) : null}

      <div className="space-y-4">
        {CHANGE_GROUPS.map((group) => {
          const entries = comparison.changes[group.kind] ?? [];
          if (entries.length === 0) return null;
          return <ChangeGroup key={group.kind} group={group} entries={entries} />;
        })}
      </div>
    </div>
  );
}

function ComparabilityNotice({
  comparability,
  warnings,
}: {
  comparability: ScanComparisonResult['comparability'];
  warnings: string[];
}) {
  if (comparability === 'COMPARABLE' && warnings.length === 0) return null;

  const tone =
    comparability === 'NOT_COMPARABLE'
      ? 'border-severity-high/30 bg-severity-high/5'
      : 'border-severity-medium/30 bg-severity-medium/5';

  return (
    <div className={cn('rounded-md border px-3 py-2.5', tone)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <IconAlertTriangle className="size-3.5 text-severity-medium" aria-hidden="true" />
        {comparability === 'NOT_COMPARABLE'
          ? 'These scans are not comparable'
          : comparability === 'PARTIALLY_COMPARABLE'
            ? 'These scans are only partially comparable'
            : 'Read this comparison with care'}
      </p>
      {warnings.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs leading-relaxed text-muted-foreground">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeltaPanel({
  label,
  before,
  after,
  delta,
  beforeStatus,
  afterStatus,
  suffix = '',
  higherIsBetter,
}: {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  beforeStatus?: string;
  afterStatus?: string;
  suffix?: string;
  higherIsBetter: boolean;
}) {
  const improved = delta != null && (higherIsBetter ? delta > 0 : delta < 0);
  const worsened = delta != null && (higherIsBetter ? delta < 0 : delta > 0);

  const DeltaIcon = delta == null || delta === 0 ? IconMinus : improved ? IconTrendingUp : IconTrendingDown;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        {beforeStatus ? (
          <ScoreCell score={before} status={beforeStatus as any} />
        ) : (
          <span className="text-sm tabular-nums text-muted-foreground">
            {before ?? '—'}
            {before != null && suffix}
          </span>
        )}
        <IconArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
        {afterStatus ? (
          <ScoreCell score={after} status={afterStatus as any} />
        ) : (
          <span className="text-sm font-medium tabular-nums text-foreground">
            {after ?? '—'}
            {after != null && suffix}
          </span>
        )}

        {delta != null && (
          <span
            className={cn(
              'ml-auto flex items-center gap-1 text-xs font-medium tabular-nums',
              improved && 'text-success',
              worsened && 'text-severity-high',
              !improved && !worsened && 'text-muted-foreground',
            )}
          >
            <DeltaIcon className="size-3.5" aria-hidden="true" />
            {delta > 0 ? '+' : ''}
            {delta}
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function CountTile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'bad' | 'good' | 'neutral' | 'warn';
}) {
  const toneClass = {
    bad: 'text-severity-high',
    good: 'text-success',
    neutral: 'text-foreground',
    warn: 'text-severity-medium',
  }[tone];

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className={cn('text-xl font-semibold tabular-nums', count === 0 ? 'text-muted-foreground' : toneClass)}>
        {count}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

function ChangeGroup({
  group,
  entries,
}: {
  group: (typeof CHANGE_GROUPS)[number];
  entries: ComparisonChangeEntry[];
}) {
  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">
        {group.label}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">({entries.length})</span>
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{group.description}</p>

      <ul className="divide-y divide-border rounded-md border border-border">
        {entries.map((entry) => (
          <li key={entry.fingerprint}>
            <Link
              href={`/issues/${entry.issueId}`}
              className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{entry.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {entry.route}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {entry.severityChangedFrom && (
                  <Badge
                    variant="outline"
                    className="h-5 border-severity-medium/30 px-1.5 text-[10px] text-severity-medium"
                  >
                    was {entry.severityChangedFrom}
                  </Badge>
                )}
                <SeverityBadge severity={entry.severity as any} size="sm" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
