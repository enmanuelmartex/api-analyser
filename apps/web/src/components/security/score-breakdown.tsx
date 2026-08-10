'use client';

import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/security/severity-badge';
import type { AssessmentScore, RulePenalty } from '@/types';

/**
 * Why the score is what it is.
 *
 * The scoring engine already produced a complete, immutable explanation for
 * every scan — which rules were penalised, at what severity, across how many
 * components — and no screen displayed any of it. The user saw a bare number
 * with no way to learn what would improve it.
 *
 * Two properties of the engine this component is careful to render honestly:
 *
 *  - The penalty unit is the *rule*, not the individual finding. One rule
 *    matching forty endpoints is one penalty scaled by an exposure multiplier,
 *    not forty penalties.
 *  - INFO findings carry a weight of zero. They appear in the list with a
 *    0-point penalty rather than being hidden, so "why didn't this cost me
 *    anything" has a visible answer.
 */
export function ScoreBreakdown({
  score,
  className,
}: {
  score: AssessmentScore;
  className?: string;
}) {
  const explanation = score.explanation;

  if (!explanation) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No score explanation was recorded for this scan.
      </p>
    );
  }

  // Highest penalty first: the ranking is the actionable part.
  const penalties = [...(explanation.rulePenalties ?? [])].sort(
    (a, b) => b.rulePenalty - a.rulePenalty,
  );

  const capped = explanation.uncappedPenalty > explanation.totalPenalty;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-muted-foreground">Starting score</span>
        <span className="font-mono text-sm tabular-nums text-foreground">100</span>
        <span className="text-sm text-muted-foreground">− penalties</span>
        <span className="font-mono text-sm tabular-nums text-severity-high">
          {explanation.totalPenalty}
        </span>
        <span className="text-sm text-muted-foreground">=</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {score.securityScore ?? '—'}
        </span>
      </div>

      {/* Saturation must be visible: without it, two very different scans both
          read as "1" with no indication that one was far worse. */}
      {capped && (
        <p className="flex items-start gap-1.5 rounded-md border border-severity-high/30 bg-severity-high/5 px-3 py-2 text-xs text-muted-foreground">
          <IconAlertTriangle
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-severity-high"
            aria-hidden="true"
          />
          <span>
            Penalties totalled {explanation.uncappedPenalty} points before the cap. The
            score reached its floor, so further findings cannot lower it.
          </span>
        </p>
      )}

      {explanation.reasons?.length > 0 && (
        <ul className="space-y-1">
          {explanation.reasons.map((reason) => (
            <li
              key={reason}
              className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              <IconInfoCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {reason}
            </li>
          ))}
        </ul>
      )}

      {penalties.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rule produced a penalty in this scan.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {penalties.map((penalty) => (
            <PenaltyRow key={penalty.aggregationKey} penalty={penalty} />
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Penalties are applied once per rule, scaled by how many distinct components the
        rule affects — not once per finding. Informational findings carry no weight.
      </p>
    </div>
  );
}

function PenaltyRow({ penalty }: { penalty: RulePenalty }) {
  const exposureScaled = penalty.exposureMultiplier > 1;

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={penalty.highestSeverity as any} size="sm" />
          <span className="truncate font-mono text-xs text-foreground">{penalty.ruleId}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {penalty.distinctAffectedComponents}{' '}
          {penalty.distinctAffectedComponents === 1 ? 'component' : 'components'} affected
          {exposureScaled && (
            <>
              {' · '}exposure ×{penalty.exposureMultiplier.toFixed(2)}
            </>
          )}
          {' · '}
          <span className="text-muted-foreground/70">{penalty.pluginId}</span>
        </p>
      </div>

      <Badge
        variant="outline"
        className={cn(
          'h-6 flex-shrink-0 px-2 font-mono text-xs tabular-nums',
          penalty.rulePenalty > 0
            ? 'border-severity-high/30 text-severity-high'
            : 'border-border text-muted-foreground',
        )}
      >
        {penalty.rulePenalty > 0 ? `−${penalty.rulePenalty}` : '0'}
      </Badge>
    </li>
  );
}
