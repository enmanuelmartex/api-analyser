import { IconCheck, IconMinus, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { OwaspCategoryCoverage, OwaspCoverageSummary } from '@/types';

/**
 * OWASP API Security Top 10 coverage, as a matrix.
 *
 * Replaces the radar chart that was the product's primary coverage
 * representation. A radar plotted *findings per category*, which reads as
 * coverage but is the opposite: a category with no check produced no findings
 * and therefore looked perfectly clean.
 *
 * The three states this component exists to keep apart:
 *
 *   COVERED     a check ran for this category. Zero issues means nothing found.
 *   COVERED +   a check ran, and part of the category is beyond what it can see
 *   scope note  from outside the target. Zero issues means less than it looks.
 *   NOT COVERED nothing was ever tested here. Zero issues means nothing looked.
 *
 * The middle state is the reason this component did not simplify when every
 * category gained a check: "10/10" is precisely the number that invites a
 * reader to stop asking what was tested, so the rows that cannot honestly claim
 * completeness say so in place of a bare tick.
 *
 * `issueCounts` is optional and orthogonal — it decorates covered rows and is
 * never allowed to imply coverage on its own.
 */
export function OwaspCoverageMatrix({
  coverage,
  issueCounts,
  className,
}: {
  coverage: OwaspCoverageSummary;
  /** Open issues per canonical category id, e.g. `{ 'API8:2023': 14 }`. */
  issueCounts?: Record<string, number>;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('space-y-1', className)}>
        {coverage.categories.map((category) => (
          <OwaspCategoryRow
            key={category.id}
            category={category}
            issueCount={issueCounts?.[category.id]}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

function OwaspCategoryRow({
  category,
  issueCount,
}: {
  category: OwaspCategoryCoverage;
  issueCount?: number;
}) {
  const covered = category.status === 'COVERED';

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-transparent px-2 py-2.5 transition-colors',
        'hover:border-border hover:bg-muted/40',
        !covered && 'opacity-90',
      )}
    >
      {/* Status is carried by an icon and a text label, not colour alone. */}
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
          covered ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {covered ? <IconCheck className="h-3 w-3" /> : <IconMinus className="h-3 w-3" />}
      </span>

      <span className="w-12 flex-shrink-0 pt-0.5 font-mono text-[11px] font-medium text-muted-foreground">
        {category.shortId}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-foreground">{category.title}</span>

          {covered ? (
            <span className="text-xs text-muted-foreground">
              {category.checkIds.length}{' '}
              {category.checkIds.length === 1 ? 'check' : 'checks'} · {category.ruleCount}{' '}
              {category.ruleCount === 1 ? 'rule' : 'rules'}
            </span>
          ) : (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-border px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              Not covered
            </Badge>
          )}
        </div>

        {covered && category.checkNames.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {category.checkNames.join(', ')}
          </p>
        )}

        {/* A covered category whose checks cannot see all of it says so here,
            in the row itself — the qualification is worthless if it only lives
            in a tooltip nobody opens. */}
        {covered && category.scopeNote && (
          <p className="mt-1 flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <IconInfoCircle
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
              aria-hidden="true"
            />
            <span>
              <span className="sr-only">Limits of this coverage: </span>
              {category.scopeNote}
            </span>
          </p>
        )}

        {/* An uncovered category must say why, or it reads as an oversight. */}
        {!covered && category.gapReason && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {category.gapReason}
          </p>
        )}
      </div>

      <div className="flex-shrink-0 pt-0.5">
        {covered && issueCount != null ? (
          issueCount > 0 ? (
            <Badge
              variant="outline"
              className="h-5 border-severity-medium/30 px-1.5 text-[10px] tabular-nums text-severity-medium"
            >
              {issueCount} open
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">None found</span>
          )
        ) : !covered ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center text-muted-foreground">
                <IconAlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">
                  {category.title} is not covered by any installed security check
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              No check tests this category. An absence of findings here means it was
              never tested, not that it is secure.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One-line coverage statement, e.g. "OWASP API Top 10 · 10/10 covered".
 *
 * Deliberately never renders a percentage and never the word "full": a ratio
 * keeps the denominator in the sentence, so a category that loses its last
 * check changes the headline instead of hiding behind a rounded figure. The
 * count of checks and rules sits beside it for the same reason — it is the part
 * a reader can go and verify.
 */
export function OwaspCoverageSummaryLine({
  coverage,
  className,
}: {
  coverage: OwaspCoverageSummary;
  className?: string;
}) {
  const complete = coverage.coveredCount === coverage.totalCount;

  return (
    <span className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
      <span className="text-muted-foreground">OWASP API Top 10 ({coverage.edition})</span>
      <Badge
        variant="outline"
        className={cn(
          'h-5 px-1.5 text-[10px] font-semibold tabular-nums',
          complete
            ? 'border-success/30 text-success'
            : 'border-severity-medium/30 text-severity-medium',
        )}
      >
        {coverage.label} covered
      </Badge>
      <span className="text-xs text-muted-foreground">
        {coverage.checkCount} {coverage.checkCount === 1 ? 'check' : 'checks'} ·{' '}
        {coverage.ruleCount} rules
      </span>
    </span>
  );
}
