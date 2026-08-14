import { cn } from '@/lib/utils';

export const STATUS_META: Record<string, { className: string; dot: string }> = {
  OPEN: { className: 'bg-destructive/10 text-destructive border-destructive/20', dot: 'bg-destructive' },
  // Replaced CONFIRMED when the persistent issue model landed. CONFIRMED is
  // kept so historical values rendered from cached data still resolve.
  ACKNOWLEDGED: { className: 'bg-severity-high/10 text-severity-high border-severity-high/20', dot: 'bg-severity-high' },
  CONFIRMED: { className: 'bg-severity-high/10 text-severity-high border-severity-high/20', dot: 'bg-severity-high' },
  FALSE_POSITIVE: { className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  RESOLVED: { className: 'bg-success/10 text-success border-success/20', dot: 'bg-success' },
  ACCEPTED_RISK: { className: 'bg-severity-low/10 text-severity-low border-severity-low/20', dot: 'bg-severity-low' },
  PENDING: { className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  QUEUED: { className: 'bg-severity-low/10 text-severity-low border-severity-low/20', dot: 'bg-severity-low' },
  RUNNING: { className: 'bg-primary/10 text-primary border-primary/20', dot: 'bg-primary animate-pulse' },
  COMPLETED: { className: 'bg-success/10 text-success border-success/20', dot: 'bg-success' },
  FAILED: { className: 'bg-destructive/10 text-destructive border-destructive/20', dot: 'bg-destructive' },
  CANCELLED: { className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide',
        meta.className,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
