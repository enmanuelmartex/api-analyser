'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { LogStatus } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The summary strip above the log explorer.
 *
 * Every figure is counted over the SAME filters the table below is showing —
 * not over all time — so the percentages describe the window an operator is
 * actually looking at. A summary that silently reports different data from the
 * table under it is worse than no summary, because both look authoritative.
 *
 * The counts come from the existing list endpoint requested with `limit=1`:
 * the server already returns `total` for any filter combination, so this needs
 * no new route and each request carries one row rather than a page of them.
 *
 * The four count tiles are also the fastest way to apply the status filter:
 * clicking one narrows the table below to that status and clicking it again
 * clears it. That writes to the same `status` filter the filter bar owns — the
 * strip has no filter state of its own — so the chip in the bar and the tile's
 * pressed state can never disagree.
 */

export interface AuditSummaryCounts {
  total: number;
  success: number;
  warning: number;
  failed: number;
}

/** `null` means "every status": the tile that clears the filter. */
export type StatusSelection = LogStatus | null;

export function AuditSummary({
  counts,
  isLoading,
  rangeLabel,
  stream,
  activeStatuses,
  onSelectStatus,
  className,
}: {
  counts?: AuditSummaryCounts;
  isLoading: boolean;
  /** The active time window, e.g. "Last 24 hours". Shown as the strip's basis. */
  rangeLabel: string;
  stream: { enabled: boolean; subscribers: number | null };
  /** The status filter currently applied to the table. Empty means all. */
  activeStatuses: LogStatus[];
  onSelectStatus: (_status: StatusSelection) => void;
  className?: string;
}) {
  const share = (value: number) =>
    !counts || counts.total === 0 ? null : `${((value / counts.total) * 100).toFixed(1)}%`;

  /*
   * A status the filter excludes is not counted at all, so its tile reads 0 —
   * true of the current view, but it would look like "there are none" rather
   * than "you filtered them out". The caption says which it is.
   */
  const excluded = (status: LogStatus) =>
    activeStatuses.length > 0 && !activeStatuses.includes(status);
  const captionFor = (status: LogStatus, value: number) =>
    excluded(status) ? 'Excluded by filter' : share(value);

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3',
        className,
      )}
    >
      <Tile
        label="Total events"
        value={counts?.total}
        caption={rangeLabel}
        isLoading={isLoading}
        active={activeStatuses.length === 0}
        onSelect={() => onSelectStatus(null)}
        actionHint="Show events of every status"
      />
      <Tile
        label="Success"
        value={counts?.success}
        caption={captionFor('SUCCESS', counts?.success ?? 0)}
        isLoading={isLoading}
        tone="success"
        active={activeStatuses.includes('SUCCESS')}
        onSelect={() => onSelectStatus('SUCCESS')}
        actionHint="Filter the table to successful events"
      />
      <Tile
        label="Warnings"
        value={counts?.warning}
        caption={captionFor('WARNING', counts?.warning ?? 0)}
        isLoading={isLoading}
        tone="warning"
        active={activeStatuses.includes('WARNING')}
        onSelect={() => onSelectStatus('WARNING')}
        actionHint="Filter the table to warnings"
      />
      <Tile
        label="Errors"
        value={counts?.failed}
        caption={captionFor('FAILED', counts?.failed ?? 0)}
        isLoading={isLoading}
        tone="error"
        active={activeStatuses.includes('FAILED')}
        onSelect={() => onSelectStatus('FAILED')}
        actionHint="Filter the table to failed events"
      />
      <StreamTile {...stream} />
    </div>
  );
}

/**
 * Tone is a 2px rail on the left edge, not a tinted card.
 *
 * Five filled cards in five colours is the "explosion of colour" this screen is
 * meant to avoid; a hairline rail is enough to find the error tile without
 * competing with the severity badges in the table below, which are the signal
 * that actually matters.
 */
const TONES = {
  neutral: 'bg-border',
  success: 'bg-success',
  warning: 'bg-severity-medium',
  error: 'bg-destructive',
} as const;

function Tile({
  label,
  value,
  caption,
  isLoading,
  tone = 'neutral',
  active,
  onSelect,
  actionHint,
}: {
  label: string;
  value?: number;
  caption?: string | null;
  isLoading: boolean;
  tone?: keyof typeof TONES;
  /** Drawn as pressed: this tile's status is the one the table is showing. */
  active: boolean;
  onSelect: () => void;
  /** Hover hint only. Deliberately not `aria-label`, which would replace the
   *  tile's own text and stop a screen reader from ever reading the count. */
  actionHint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={actionHint}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active ? 'border-foreground/30 bg-muted/40' : 'border-border hover:border-foreground/20',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-0.5', TONES[tone])}
      />
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-foreground">
          {value?.toLocaleString() ?? '—'}
        </p>
      )}
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {isLoading ? ' ' : (caption ?? ' ')}
      </p>
    </button>
  );
}

/** The stream tile reports the server's real subscriber count, not this tab's. */
function StreamTile({ enabled, subscribers }: { enabled: boolean; subscribers: number | null }) {
  const live = enabled && (subscribers ?? 0) > 0;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-0.5', live ? 'bg-success' : 'bg-border')}
      />
      <p className="text-[11px] font-medium text-muted-foreground">Event stream</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <span
          className={cn(
            'h-1.5 w-1.5 flex-shrink-0 rounded-full',
            live ? 'animate-pulse bg-success' : enabled ? 'bg-muted-foreground/40' : 'bg-border',
          )}
          aria-hidden="true"
        />
        {enabled ? (live ? 'Live' : 'Idle') : 'Disabled'}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="mt-0.5 cursor-default truncate text-[11px] text-muted-foreground">
            {enabled
              ? `${(subscribers ?? 0).toLocaleString()} subscriber${subscribers === 1 ? '' : 's'}`
              : 'Switched off'}
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {enabled
            ? 'Administrators currently attached to the real-time stream across all sessions, as counted by the API.'
            : 'Live streaming is switched off in Log management. Events are still recorded.'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
