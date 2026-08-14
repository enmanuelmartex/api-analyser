import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type ScheduledScan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssessmentsService } from '../assessments/assessments.service';
import type {
  ScheduleRunFailedEvent,
  ScheduleRunSkippedEvent,
  ScheduleRunStartedEvent,
} from '../events/domain-events';
import { computeNextRun } from './recurrence/recurrence';
import { toRule } from './schedule-rule';

/** Postgres unique-violation, surfaced by Prisma. The duplicate guard firing. */
const UNIQUE_VIOLATION = 'P2002';

/** Assessment states that mean a run from this schedule is still in flight. */
const IN_FLIGHT = ['PENDING', 'QUEUED', 'RUNNING'] as const;

export interface DispatchResult {
  /** False when another instance had already claimed this occurrence. */
  claimed: boolean;
  skipped: boolean;
  assessmentId?: string;
  executionId?: string;
  reason?: string;
}

/**
 * Turns a due occurrence into a real assessment.
 *
 * This is the only place scheduling meets scanning, and it is deliberately
 * thin: it decides WHETHER to run, then hands over to
 * `AssessmentsService.createAndRun` — the exact method the "Run Assessment"
 * button calls. There is no second scan engine, no duplicated plugin
 * resolution, and no separate queue for scheduled work. A scheduled scan is an
 * ordinary scan with a different reason for existing.
 *
 * ── How a duplicate is prevented, in three independent layers ───────────────
 *
 *  1. BullMQ delivers the scheduler tick to exactly one worker. On its own this
 *     is not enough: it is a Redis guarantee, and Redis can be restarted,
 *     flushed or replaced.
 *
 *  2. The occurrence is CLAIMED with a conditional update — "set nextRunAt to
 *     the following occurrence, but only if it is still the value I read". Two
 *     API instances racing produce exactly one update with count 1; the loser
 *     sees count 0 and stops. This is a compare-and-swap in Postgres, so it
 *     holds no lock and needs no coordination.
 *
 *  3. `schedule_executions` is UNIQUE on (scheduleId, scheduledFor), and
 *     `scheduledFor` comes from the recurrence rule rather than from a clock.
 *     Any path that still reached a second insert for one occurrence — a
 *     restored database snapshot, a hand-edited row — fails on the constraint
 *     instead of starting a second scan.
 *
 * Layer 2 alone would be enough on a healthy system. Layer 3 is what makes the
 * guarantee survive an unhealthy one.
 */
@Injectable()
export class ScheduleDispatcherService {
  private readonly logger = new Logger(ScheduleDispatcherService.name);

  constructor(
    private prisma: PrismaService,
    private assessments: AssessmentsService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Handles one schedule whose `nextRunAt` has arrived.
   *
   * The occurrence is claimed BEFORE any work is attempted, so a failure to
   * start the scan cannot leave the schedule due forever, re-firing on every
   * tick against an API that is already refusing it.
   */
  async dispatchDue(schedule: ScheduledScan, now = new Date()): Promise<DispatchResult> {
    const occurrence = schedule.nextRunAt;
    if (!occurrence) return { claimed: false, skipped: false, reason: 'No occurrence is due' };

    /*
     * The following occurrence is computed from NOW, not from the one being
     * dispatched.
     *
     * That single choice is what stops a backlog replay. A service that was
     * down for a week comes back with an occurrence from last Monday; advancing
     * one step at a time would then dispatch every intervening Monday in a
     * loop. Computing forward from the current instant runs the missed
     * occurrence once and resumes the normal cadence.
     */
    const following = computeNextRun(toRule(schedule), now);
    const claimed = await this.claimOccurrence(schedule, occurrence, following);
    if (!claimed) {
      this.logger.debug(
        `Schedule ${schedule.id} occurrence ${occurrence.toISOString()} was claimed elsewhere`,
      );
      return { claimed: false, skipped: false, reason: 'Claimed by another instance' };
    }

    const result = await this.run(schedule, occurrence, 'SCHEDULED');
    return { ...result, claimed: true };
  }

  /**
   * "Run now" — the schedule's configuration, immediately, on demand.
   *
   * Uses the current instant as its occurrence so it cannot collide with a
   * planned one, and never touches `nextRunAt`: the automatic series carries on
   * exactly as it would have. `skipIfRunning` still applies, because two
   * concurrent scans of one API are just as unwelcome when a person asked for
   * the second one.
   */
  async runNow(scheduleId: string, actorId: string): Promise<DispatchResult> {
    const schedule = await this.prisma.scheduledScan.findUnique({ where: { id: scheduleId } });
    if (!schedule) return { claimed: false, skipped: false, reason: 'Scheduled scan not found' };

    const result = await this.run(schedule, new Date(), 'MANUAL', actorId);
    return { ...result, claimed: true };
  }

  /**
   * Compare-and-swap on `nextRunAt`.
   *
   * `updateMany` rather than `update` because the WHERE clause has to include
   * the value being replaced — that is the entire mechanism. `count` is the
   * answer: 1 means this process owns the occurrence, 0 means somebody else got
   * there first and this one must do nothing at all.
   */
  private async claimOccurrence(
    schedule: ScheduledScan,
    occurrence: Date,
    following: Date | null,
  ): Promise<boolean> {
    const result = await this.prisma.scheduledScan.updateMany({
      where: { id: schedule.id, status: 'ACTIVE', nextRunAt: occurrence },
      data: {
        nextRunAt: following,
        // A rule with nothing left to run is finished, not silently idle. This
        // is how a ONCE schedule reaches COMPLETED, and it is why the list can
        // show that state truthfully.
        ...(following ? {} : { status: 'COMPLETED' as const }),
      },
    });

    return result.count === 1;
  }

  /**
   * Records the attempt, decides whether to scan, and starts the scan.
   *
   * Every path writes a `schedule_executions` row, including the ones that do
   * not scan. "Why did my 02:00 scan not run?" must be answerable from the
   * table, and an absent row answers nothing.
   */
  private async run(
    schedule: ScheduledScan,
    scheduledFor: Date,
    trigger: 'SCHEDULED' | 'MANUAL',
    actorId?: string,
  ): Promise<Omit<DispatchResult, 'claimed'>> {
    const project = await this.prisma.project.findUnique({
      where: { id: schedule.projectId },
      select: { id: true, name: true, userId: true },
    });

    if (!project) {
      // The project is gone but the schedule row survived — only possible in a
      // partially restored database, since the FK cascades.
      this.logger.warn(`Schedule ${schedule.id} points at a missing project`);
      return { skipped: false, reason: 'The project no longer exists' };
    }

    // ── 1. Claim the occurrence in the executions table ──────────────────────
    let executionId: string;
    try {
      const execution = await this.prisma.scheduleExecution.create({
        data: { scheduleId: schedule.id, scheduledFor, status: 'QUEUED', trigger },
        select: { id: true },
      });
      executionId = execution.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        this.logger.warn(
          `Schedule ${schedule.id} already has an execution for ${scheduledFor.toISOString()}; not starting a second scan`,
        );
        return { skipped: true, reason: 'This occurrence has already been dispatched' };
      }
      throw error;
    }

    // ── 2. Is a run from this schedule still going? ──────────────────────────
    if (schedule.skipIfRunning) {
      const inFlight = await this.prisma.assessment.findFirst({
        where: { scheduleId: schedule.id, status: { in: [...IN_FLIGHT] } },
        select: { id: true, status: true },
        orderBy: { createdAt: 'desc' },
      });

      if (inFlight) {
        const reason =
          `The previous scan from this schedule is still ${inFlight.status.toLowerCase()}. ` +
          'This occurrence was skipped.';

        await this.prisma.scheduleExecution.update({
          where: { id: executionId },
          data: { status: 'SKIPPED', reason, finishedAt: new Date() },
        });

        this.eventEmitter.emit('schedule.run.skipped', {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          projectId: project.id,
          projectName: project.name,
          executionId,
          scheduledFor,
          reason,
          userId: project.userId,
        } satisfies ScheduleRunSkippedEvent);

        this.logger.log(`Schedule ${schedule.id} skipped: ${inFlight.id} is still ${inFlight.status}`);
        return { skipped: true, executionId, reason };
      }
    }

    // ── 3. Hand over to the ordinary scan pipeline ───────────────────────────
    try {
      const assessment = await this.assessments.createAndRun(
        project.id,
        /*
         * The scan runs as the project's owner, not as whoever pressed a
         * button.
         *
         * Per-user check enable/disable lives on the owner's account, so an
         * automatic run must resolve the same selection their manual run would.
         * The audit trail still attributes the run to the scheduler — see
         * `initiatedBy` below — so this does not pretend a person did it.
         */
        project.userId,
        {
          executionMode: schedule.executionMode as 'all' | 'profile' | 'manual',
          scanProfileId: schedule.scanProfileId ?? undefined,
          manualPlugins: schedule.manualPlugins,
          enableAiAnalysis: schedule.enableAiAnalysis,
          maxRequestsPerEndpoint: schedule.maxRequestsPerEndpoint,
          requestDelayMs: schedule.requestDelayMs,
          timeoutMs: schedule.timeoutMs,
        },
        {
          trigger: 'SCHEDULED',
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          initiatedBy: trigger === 'MANUAL' ? 'USER' : 'SCHEDULER',
          actorId,
        },
      );

      await this.prisma.$transaction([
        this.prisma.scheduleExecution.update({
          where: { id: executionId },
          data: { assessmentId: assessment.id, status: 'QUEUED' },
        }),
        this.prisma.scheduledScan.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: new Date(),
            totalRuns: { increment: 1 },
            // A run that started clears the failure streak: the counter tracks
            // consecutive failures to START, which is what an unattended
            // schedule silently failing looks like.
            consecutiveFailures: 0,
          },
        }),
      ]);

      this.eventEmitter.emit('schedule.run.started', {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        projectId: project.id,
        projectName: project.name,
        assessmentId: assessment.id,
        executionId,
        scheduledFor,
        trigger,
        userId: project.userId,
      } satisfies ScheduleRunStartedEvent);

      this.logger.log(
        `Schedule ${schedule.id} started assessment ${assessment.id} for ${project.name} ` +
          `(occurrence ${scheduledFor.toISOString()}, ${trigger.toLowerCase()})`,
      );

      return { skipped: false, assessmentId: assessment.id, executionId };
    } catch (error) {
      /*
       * Starting the scan failed — and the schedule survives it.
       *
       * A specification withdrawn, every check disabled, Redis briefly
       * unreachable: all real, all transient or fixable, and none of them a
       * reason to silently stop scanning a production API forever. The failure
       * is recorded against this execution, the counter goes up so an operator
       * can see a schedule that has been failing unattended, and `nextRunAt`
       * has already been advanced, so the next occurrence is tried normally.
       */
      const reason = (error as Error).message ?? 'The scan could not be started';

      const [, updated] = await this.prisma.$transaction([
        this.prisma.scheduleExecution.update({
          where: { id: executionId },
          data: { status: 'FAILED', reason, finishedAt: new Date() },
        }),
        this.prisma.scheduledScan.update({
          where: { id: schedule.id },
          data: { consecutiveFailures: { increment: 1 } },
          select: { consecutiveFailures: true },
        }),
      ]);

      this.eventEmitter.emit('schedule.run.failed', {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        projectId: project.id,
        projectName: project.name,
        executionId,
        scheduledFor,
        reason,
        consecutiveFailures: updated.consecutiveFailures,
        userId: project.userId,
      } satisfies ScheduleRunFailedEvent);

      this.logger.error(`Schedule ${schedule.id} could not start a scan: ${reason}`);
      return { skipped: false, executionId, reason };
    }
  }
}
