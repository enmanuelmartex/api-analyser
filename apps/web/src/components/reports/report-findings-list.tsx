'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconShieldCheck } from '@tabler/icons-react';
import type { FindingOccurrence, Severity } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { Separator } from '@/components/ui/separator';

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

const PAGE = 15;

/**
 * The findings this report contains.
 *
 * Rendered from the assessment's occurrence snapshots — the wording, severity
 * and scores captured at detection time — so the list matches the delivered
 * document even after the underlying issues have been re-triaged or reworded.
 *
 * Selecting a finding navigates to its live issue for triage. Triage is
 * deliberately not editable from here: a report is a historical record, and
 * changing an issue's status from inside it would blur the two.
 */
export function ReportFindingsList({ findings }: { findings: FindingOccurrence[] }) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () =>
      [...findings].sort((a, b) => {
        const bySeverity =
          (SEVERITY_ORDER[a.severitySnapshot] ?? 9) - (SEVERITY_ORDER[b.severitySnapshot] ?? 9);
        if (bySeverity !== 0) return bySeverity;
        // Within a severity, the highest CVSS first; then stable by title.
        const byCvss = (b.cvssSnapshot ?? 0) - (a.cvssSnapshot ?? 0);
        return byCvss !== 0 ? byCvss : a.titleSnapshot.localeCompare(b.titleSnapshot);
      }),
    [findings],
  );

  const visible = expanded ? sorted : sorted.slice(0, PAGE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Findings included</CardTitle>
        <CardDescription>
          {findings.length === 0
            ? 'This report contains no findings.'
            : `${findings.length} finding${findings.length === 1 ? '' : 's'}, ordered by severity. Snapshots taken when the report was issued.`}
        </CardDescription>
      </CardHeader>

      <CardContent className={findings.length ? 'p-0' : undefined}>
        {findings.length === 0 ? (
          <EmptyState
            icon={IconShieldCheck}
            title="No findings in this report"
            description="The scan this report describes did not record any finding."
            compact
          />
        ) : (
          <>
            {visible.map((finding, index) => (
              <div key={finding.id}>
                {index > 0 && <Separator />}
                {/*
                  Two lines: what it is, then where and how bad. The metadata
                  sits under the endpoint rather than in a far-right column, so
                  it stays attached to its finding as the column narrows instead
                  of drifting a card-width away.
                */}
                <Link
                  href={`/issues/${finding.issueId}`}
                  className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-accent/50"
                >
                  <SeverityBadge
                    severity={finding.severitySnapshot}
                    size="sm"
                    className="mt-0.5 w-[68px] shrink-0 justify-center"
                  />

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {finding.titleSnapshot}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {finding.methodSnapshot} {finding.pathSnapshot}
                      </span>
                      {finding.owaspSnapshot && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {finding.owaspSnapshot}
                        </Badge>
                      )}
                      {finding.cvssSnapshot != null && (
                        <Badge variant="neutral" className="text-[10px] tabular-nums">
                          CVSS {finding.cvssSnapshot.toFixed(1)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <IconChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </Link>
              </div>
            ))}

            {sorted.length > PAGE && (
              <>
                <Separator />
                <div className="px-6 py-3">
                  <Button variant="ghost" size="sm" onClick={() => setExpanded((open) => !open)}>
                    {expanded
                      ? 'Show fewer'
                      : `Show all ${sorted.length} findings`}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
