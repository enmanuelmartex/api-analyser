import Link from 'next/link';
import { IconArrowDown, IconArrowUp, IconChevronRight, IconMinus } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SEVERITY_META } from '@/components/security/severity-badge';

/**
 * The single summary card used by every metrics row in the product — Dashboard,
 * Issues, Reports and Security Checks.
 *
 * It replaced three near-identical cards that had drifted apart in padding,
 * value size and colour. The important addition is not visual: a metric that
 * corresponds to a filtered view now links to it, so the number and the list
 * behind it are one click apart instead of two screens.
 *
 * The whole card is the link — there is no "View …" row under the description.
 * That row is what made these cards a third taller than the ones they replaced,
 * and a metrics strip is meant to be read at a glance, not to carry a paragraph.
 * The chevron and the hover border say the card is clickable; a card with no
 * honest destination gets neither, which is how the two kinds stay
 * distinguishable.
 */

export type MetricAccent =
  | 'default'
  | 'primary'
  | 'success'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

/**
 * Severity accents come straight from `SEVERITY_META`, the same source the
 * badges and the severity filter read. There is deliberately no second palette
 * here: anything that is not a severity is neutral, and colour on these cards
 * only ever means severity, health or brand.
 */
const ACCENT_CLASS: Record<MetricAccent, string> = {
  default: 'border border-border bg-muted text-muted-foreground',
  primary: 'border border-primary/20 bg-primary/10 text-primary',
  success: 'border border-success/20 bg-success/10 text-success',
  critical: SEVERITY_META.CRITICAL.className,
  high: SEVERITY_META.HIGH.className,
  medium: SEVERITY_META.MEDIUM.className,
  low: SEVERITY_META.LOW.className,
  info: SEVERITY_META.INFO.className,
};

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

const DELTA_VARIANT = {
  positive: 'success-light',
  negative: 'destructive-light',
  neutral: 'neutral',
} as const;

export interface MetricCardProps {
  title: string;
  value: string | number;
  /** Rendered smaller and dimmer next to the value, e.g. "/100". */
  suffix?: string;
  /** One short line saying what the value is counted over. */
  description?: string;
  icon: React.ReactNode;
  accent?: MetricAccent;
  /** Makes the whole card a link. Omit for an informational card. */
  href?: string;
  /** Only ever present when the caller computed it from real prior-period data. */
  delta?: MetricDelta | null;
  valueClassName?: string;
  loading?: boolean;
  className?: string;
}

export function MetricCard({
  title,
  value,
  suffix,
  description,
  icon,
  accent = 'default',
  href,
  delta,
  valueClassName,
  loading,
  className,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton className={className} />;

  const card = (
    <Card
      className={cn(
        'flex h-full flex-col gap-3 p-4 shadow-none',
        href && 'transition-colors group-hover:border-foreground/20',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
            ACCENT_CLASS[accent],
          )}
        >
          {icon}
        </span>
        {delta ? (
          <Badge variant={DELTA_VARIANT[delta.tone]} className="gap-1 text-[11px] tabular-nums">
            {delta.direction === 'up' && <IconArrowUp className="size-3" aria-hidden="true" />}
            {delta.direction === 'down' && <IconArrowDown className="size-3" aria-hidden="true" />}
            {delta.direction === 'flat' && <IconMinus className="size-3" aria-hidden="true" />}
            {delta.label}
          </Badge>
        ) : (
          // The only affordance left once the "View …" row is gone, so it sits
          // in the row that already exists rather than adding height.
          href && (
            <IconChevronRight
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            />
          )
        )}
      </div>

      {/*
        `mt-auto`: cards in a grid row stretch to the tallest one, and whatever
        slack that creates should sit under the icon as breathing room, not
        below the text as a dead band. Text sits on the bottom edge, so the
        descriptions of a row line up however many lines each one takes.
      */}
      <div className="mt-auto space-y-0.5">
        <h2 className="text-sm font-medium leading-tight text-foreground">{title}</h2>
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              'text-2xl font-semibold tracking-tight tabular-nums text-foreground',
              valueClassName,
            )}
          >
            {value}
          </span>
          {suffix && <span className="text-xs tabular-nums text-muted-foreground">{suffix}</span>}
        </div>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
    </Card>
  );

  if (!href) return card;

  /*
   * The card is wrapped rather than given a stretched anchor: one interactive
   * element, a real href the browser can open in a new tab, and an accessible
   * name that reads as the card does — "Critical Findings 4 Require immediate
   * attention" — instead of a bare "View critical findings".
   */
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
}

/** Mirrors the card's structure so a metrics row does not shift when data lands. */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('flex h-full flex-col gap-3 p-4 shadow-none', className)}>
      <Skeleton className="size-8 rounded-lg" />
      <div className="mt-auto space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-32" />
      </div>
    </Card>
  );
}
