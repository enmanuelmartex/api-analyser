import type { ScheduledScan } from '@prisma/client';
import type { RecurrenceRule } from './recurrence/recurrence';

/**
 * The two pure readings of a stored schedule, kept out of both services.
 *
 * The dispatcher needs `toRule` to compute the following occurrence, and the
 * service needs it to describe and preview one. Putting it in either service
 * would make the two import each other, and a cycle between a provider and its
 * own dependency is the kind of thing that works until the day module
 * initialisation order changes.
 */

/**
 * A stored row, read as a recurrence rule.
 *
 * Deliberately structural rather than a mapping: the columns were named to
 * match `RecurrenceRule` exactly, so a field added to one is a compile error in
 * the other rather than a silently ignored value.
 */
export function toRule(schedule: ScheduledScan): RecurrenceRule {
  return {
    frequency: schedule.frequency,
    timezone: schedule.timezone,
    hour: schedule.hour,
    minute: schedule.minute,
    intervalHours: schedule.intervalHours,
    weekdays: schedule.weekdays,
    monthDay: schedule.monthDay,
    cronExpression: schedule.cronExpression,
    startAt: schedule.startAt,
  };
}

/**
 * The activity state a schedule is presented with.
 *
 * Wider than the stored `ScheduleStatus` on purpose: RUNNING and FAILED are
 * facts about the most recent execution, and persisting them on the schedule
 * would leave a crashed worker's schedule stuck at RUNNING with nothing to
 * clear it.
 */
export type ScheduleDisplayStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'RUNNING' | 'FAILED';

/**
 * The status an operator sees, from the stored intent plus the latest execution.
 *
 * Order matters. A schedule with a scan in flight reads RUNNING even though its
 * stored status is ACTIVE, because "is it working right now?" is the question
 * the column exists to answer. A PAUSED schedule never reads RUNNING: pausing
 * is an explicit decision and must not be visually overridden by a run that was
 * already under way when it was paused.
 */
export function displayStatusOf(
  schedule: { status: string },
  lastExecution: { status: string } | null | undefined,
): ScheduleDisplayStatus {
  if (schedule.status === 'PAUSED') return 'PAUSED';
  if (lastExecution?.status === 'RUNNING' || lastExecution?.status === 'QUEUED') return 'RUNNING';
  if (schedule.status === 'COMPLETED') return 'COMPLETED';
  if (lastExecution?.status === 'FAILED') return 'FAILED';
  return 'ACTIVE';
}
