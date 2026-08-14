import { cn } from '@/lib/utils';
import type { LogCategory, LogSeverity, LogStatus } from '@/types';

/**
 * Severity, category and status markers for the log explorer.
 *
 * Every class here resolves to a token that already exists in the theme — no
 * new colour is introduced and no raw Tailwind palette value is used, so these
 * follow light and dark exactly like the rest of the product:
 *
 *   DEBUG    muted            grey, recedes
 *   INFO     cyan             the existing secondary data accent
 *   WARNING  severity-medium  amber
 *   ERROR    destructive      red
 *   CRITICAL severity-critical the strongest red in the system
 *
 * Tinted rather than filled, matching Badge: a dense table of solid pills is
 * unreadable, and severity has to be legible at a glance across fifty rows.
 */

const SEVERITY_CLASSES: Record<LogSeverity, string> = {
  DEBUG: 'border-border bg-muted text-muted-foreground',
  INFO: 'border-cyan/20 bg-cyan/10 text-cyan',
  WARNING: 'border-severity-medium/20 bg-severity-medium/10 text-severity-medium',
  ERROR: 'border-destructive/20 bg-destructive/10 text-destructive',
  CRITICAL: 'border-severity-critical/30 bg-severity-critical/15 text-severity-critical',
};

export function LogSeverityBadge({
  severity,
  className,
}: {
  severity: LogSeverity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider',
        SEVERITY_CLASSES[severity] ?? SEVERITY_CLASSES.INFO,
        className,
      )}
    >
      {severity}
    </span>
  );
}

/**
 * A 1.5px bar rather than a pill.
 *
 * Used as the leading element of each row in the live viewer, where fifty
 * badges stacked vertically would be visual noise but a colour rail still lets
 * the eye find the errors while scrolling.
 */
export function SeverityRail({ severity }: { severity: LogSeverity }) {
  const tone: Record<LogSeverity, string> = {
    DEBUG: 'bg-muted-foreground/30',
    INFO: 'bg-cyan/60',
    WARNING: 'bg-severity-medium',
    ERROR: 'bg-destructive',
    CRITICAL: 'bg-severity-critical',
  };
  return (
    <span
      aria-hidden="true"
      className={cn('block h-full w-0.5 flex-shrink-0 rounded-full', tone[severity])}
    />
  );
}

const STATUS_CLASSES: Record<LogStatus, string> = {
  SUCCESS: 'border-success/20 bg-success/10 text-success',
  FAILED: 'border-destructive/20 bg-destructive/10 text-destructive',
  WARNING: 'border-severity-medium/20 bg-severity-medium/10 text-severity-medium',
};

const STATUS_LABELS: Record<LogStatus, string> = {
  SUCCESS: 'Success',
  FAILED: 'Failed',
  WARNING: 'Warning',
};

export function LogStatusBadge({ status, className }: { status: LogStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        STATUS_CLASSES[status] ?? STATUS_CLASSES.SUCCESS,
        className,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * Category is deliberately monochrome.
 *
 * Thirteen categories cannot each have a meaningful colour — the result is a
 * rainbow that carries no information and competes with severity, which is the
 * signal that actually matters in a log table.
 */
export function LogCategoryBadge({
  category,
  className,
}: {
  category: LogCategory;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground',
        className,
      )}
    >
      {category.toLowerCase()}
    </span>
  );
}

/** Title-cases a dotted event name for display: `auth.login.failed` → `Auth login failed`. */
export function humaniseEvent(event: string): string {
  const words = event.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
