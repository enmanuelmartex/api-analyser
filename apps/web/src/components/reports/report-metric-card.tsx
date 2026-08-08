'use client';

import { IconArrowDown, IconArrowUp, IconMinus } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface MetricDelta {
  label: string;
  /**
   * Whether the movement is good or bad *for security* — not whether the number
   * went up. Fewer vulnerabilities is an improvement even though the arrow
   * points down, so the caller decides the tone rather than the sign doing it.
   */
  tone: 'positive' | 'negative' | 'neutral';
  /** Direction of the underlying number, drawn as an arrow. */
  direction?: 'up' | 'down' | 'flat';
}

interface ReportMetricCardProps {
  label: string;
  value: string;
  /** Rendered smaller and dimmer next to the value, e.g. "/100". */
  suffix?: string;
  /** One line under the separator explaining what the value is counted over. */
  context?: string;
  /** Omitted entirely when there is no real prior period to compare against. */
  delta?: MetricDelta | null;
  valueClassName?: string;
  loading?: boolean;
}

const DELTA_VARIANT = {
  positive: 'success-light',
  negative: 'destructive-light',
  neutral: 'neutral',
} as const;

/**
 * One figure on the Reports header row.
 *
 * There is no overflow menu: a metric card gets one only when it has real
 * actions behind it, and these have none. A delta badge appears only when the
 * caller computed one from actual prior-period data — the card has no way to
 * invent a percentage, by design.
 */
export function ReportMetricCard({
  label,
  value,
  suffix,
  context,
  delta,
  valueClassName,
  loading,
}: ReportMetricCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-2.5">
            <Skeleton className="h-8 w-20" />
            <Separator />
            <Skeleton className="h-3 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-baseline gap-2.5">
            <span
              className={cn(
                'text-2xl font-medium tracking-tight tabular-nums text-foreground',
                valueClassName,
              )}
            >
              {value}
            </span>
            {suffix && <span className="text-sm text-muted-foreground tabular-nums">{suffix}</span>}
            {delta && (
              <Badge
                variant={DELTA_VARIANT[delta.tone]}
                className="ml-auto gap-1 text-[11px] tabular-nums"
              >
                {delta.direction === 'up' && <IconArrowUp className="size-3" aria-hidden="true" />}
                {delta.direction === 'down' && <IconArrowDown className="size-3" aria-hidden="true" />}
                {delta.direction === 'flat' && <IconMinus className="size-3" aria-hidden="true" />}
                {delta.label}
              </Badge>
            )}
          </div>

          <Separator />

          <p className="text-xs text-muted-foreground">{context ?? ' '}</p>
        </div>
      </CardContent>
    </Card>
  );
}
