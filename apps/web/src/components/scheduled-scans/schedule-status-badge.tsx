import type { ScheduleDisplayStatus, ScheduleExecutionStatus } from '@/types';
import { EXECUTION_STATUS_META, SCHEDULE_STATUS_META } from '@/lib/schedule-list';
import { cn } from '@/lib/utils';

/**
 * The activity state of a schedule.
 *
 * A dot plus a word rather than a colour-only pill: status is the column an
 * operator scans down, and colour alone is not readable to everyone. The dot
 * carries the same colour the filter dropdown uses for that status, so the two
 * are recognisably the same thing.
 */
export function ScheduleStatusBadge({
  status,
  className,
}: {
  status: ScheduleDisplayStatus;
  className?: string;
}) {
  const meta = SCHEDULE_STATUS_META[status] ?? SCHEDULE_STATUS_META.ACTIVE;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          meta.dot,
          // A run in flight is the one state that is actively changing, so it
          // is the only one that animates. Animating the rest would be noise.
          status === 'RUNNING' && 'animate-pulse',
        )}
      />
      {meta.label}
    </span>
  );
}

/** The outcome of one execution, in the same visual language. */
export function ExecutionStatusBadge({
  status,
  className,
}: {
  status: ScheduleExecutionStatus;
  className?: string;
}) {
  const meta = EXECUTION_STATUS_META[status] ?? EXECUTION_STATUS_META.QUEUED;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
