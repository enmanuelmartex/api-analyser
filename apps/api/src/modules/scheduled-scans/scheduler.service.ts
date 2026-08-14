import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleDispatcherService } from './schedule-dispatcher.service';
import { computeNextRun } from './recurrence/recurrence';
import { toRule } from './schedule-rule';

/**
 * Kept registered so a legacy repeatable registration can be cleaned up at
 * boot. Nothing is produced onto this queue any more — see the note on the
 * heartbeat below.
 */
export const SCHEDULER_QUEUE = 'scheduled-scans';
const LEGACY_TICK_JOB_NAME = 'scheduler-tick';

/**
 * How often the scheduler looks for work.
 *
 * A minute is the resolution the product promises — schedules are configured to
 * the minute and nothing finer, and the cron field enforces a fifteen-minute
 * floor. A shorter tick would add load without making any schedule more
 * punctual; a longer one would make a 02:00 scan visibly late.
 */
const TICK_INTERVAL_MS = 60_000;

/** Upper bound on schedules handled in one tick, so a backlog cannot stall it. */
const MAX_DUE_PER_TICK = 100;

/**
 * A dispatch that never reported an outcome is abandoned after this long. The
 * only way to reach it is a process dying between creating the execution row
 * and starting the scan, so the window only has to exceed a normal enqueue.
 */
const ORPHAN_DISPATCH_MS = 15 * 60_000;

export interface TickResult {
  due: number;
  dispatched: number;
  skipped: number;
  failed: number;
  contended: number;
  reconciled: number;
  durationMs: number;
}

/**
 * The clock behind scheduled scans.
 *
 * ── Why this is an in-process interval, and not a BullMQ repeatable job ─────
 *
 * It WAS a repeatable job. That design was wrong, and it failed in exactly the
 * way that matters most for this feature: silently, permanently, while
 * appearing healthy in the UI.
 *
 * BullMQ derives a repeatable job's id from its slot — `repeat:<hash>:<millis>`
 * — and refuses to insert an id that already exists. Restart the API inside the
 * same minute as a tick that has already completed, and the boot-time
 * registration lands on that same slot, collides with the finished job, and the
 * chain that would have scheduled the next tick is never extended. The queue
 * then holds a repeat CONFIG with no delayed job behind it: no tick ever runs
 * again, no error is raised, and every schedule in the installation quietly
 * stops. This was observed in a real environment — a restart at 23:12:09
 * against a tick completed at 23:12:00 killed the scheduler outright, and the
 * only trace was `delayed = 0` in Redis.
 *
 * The original reason for preferring the queue was that an in-process timer
 * runs once per API replica. That reason does not survive scrutiny: correctness
 * here has never depended on the timer being singular. An occurrence is claimed
 * with a compare-and-swap on `nextRunAt`, and `schedule_executions` is unique on
 * (scheduleId, scheduledFor) — so a second replica ticking at the same instant
 * loses the claim and does nothing. Ten replicas would be wasteful, not wrong.
 *
 * So liveness now lives where it cannot be broken by Redis bookkeeping, and
 * correctness stays where it always was: in Postgres. A timer cannot lose its
 * chain, and if a tick throws, the next one still fires.
 *
 * Scans themselves are unaffected — the dispatcher still hands every run to the
 * ordinary `scanner` queue, with the same concurrency and retry policy as a
 * manual scan.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  private timer?: ReturnType<typeof setInterval>;
  /** Guards against a slow tick overlapping the next one. */
  private ticking = false;
  /** Consecutive tick failures, so the alarm is raised once rather than per minute. */
  private consecutiveTickFailures = 0;

  private lastTickAt: Date | null = null;
  private lastTickError: string | null = null;

  constructor(
    @InjectQueue(SCHEDULER_QUEUE) private queue: Queue,
    private prisma: PrismaService,
    private dispatcher: ScheduleDispatcherService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Boot: repair state, start the heartbeat, and sweep once immediately.
   *
   * The immediate sweep matters: occurrences that came due while the process was
   * down are picked up at once rather than up to a minute later, which is what
   * makes a restart invisible to the operator.
   */
  async onModuleInit() {
    await this.removeLegacyRepeatable();

    await this.reconcile().catch((error) =>
      this.logger.error(`Schedule reconciliation failed: ${(error as Error).message}`),
    );

    this.start();

    /*
     * Awaited, not fired and forgotten.
     *
     * Boot must not report ready while occurrences that came due during the
     * restart sit unhandled — that gap is exactly how a schedule silently
     * misses its slot. The sweep is bounded (MAX_DUE_PER_TICK) and only
     * enqueues work, and `safeTick` cannot throw, so this can delay startup by
     * a query or two but can never block or fail it.
     */
    await this.safeTick();
  }

  onModuleDestroy() {
    this.stop();
  }

  /** Starts the heartbeat. Idempotent, so a double init cannot double-tick. */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.safeTick(), TICK_INTERVAL_MS);
    this.logger.log(`Scheduler heartbeat started (every ${TICK_INTERVAL_MS / 1000}s)`);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.log('Scheduler heartbeat stopped');
  }

  /** What the health surface reports. Cheap, and never throws. */
  getHealth() {
    return {
      running: Boolean(this.timer),
      lastTickAt: this.lastTickAt,
      consecutiveFailures: this.consecutiveTickFailures,
      lastError: this.lastTickError,
      intervalMs: TICK_INTERVAL_MS,
    };
  }

  /**
   * One heartbeat beat.
   *
   * NOTHING may escape this method. It is the callback of a `setInterval`, and
   * an unhandled rejection here would take the process down and with it every
   * schedule in the installation — the precise failure this design exists to
   * prevent.
   */
  private async safeTick(): Promise<void> {
    if (this.ticking) {
      // A tick that outlives its interval is a signal in itself: the previous
      // one is still working through a backlog, and starting a second would
      // just contend with it for the same claims.
      this.logger.warn('Previous scheduler tick is still running; skipping this beat');
      return;
    }

    this.ticking = true;
    try {
      await this.tick();
      this.lastTickAt = new Date();

      if (this.consecutiveTickFailures > 0) {
        this.logger.log(`Scheduler recovered after ${this.consecutiveTickFailures} failed tick(s)`);
        this.consecutiveTickFailures = 0;
        this.lastTickError = null;
      }
    } catch (error) {
      this.consecutiveTickFailures += 1;
      this.lastTickError = (error as Error).message;
      this.reportTickFailure(error as Error);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Makes a broken scheduler visible.
   *
   * The old design's worst property was not that it broke — it is that nobody
   * could tell. The failure lived in a Redis key an operator would never look
   * at, while the UI kept showing "Active" next to a next-run time that had
   * already passed. A failing tick is now an ERROR in the event log (always
   * collected, whatever the collection setting) and, on the first failure of a
   * streak, a notification to administrators.
   */
  private reportTickFailure(error: Error) {
    this.logger.error(`Scheduler tick failed: ${error.message}`, error.stack);

    this.eventEmitter.emit('system.error', {
      event: 'scheduler.tick.failed',
      category: 'WORKER',
      resource: 'scheduler',
      source: 'scheduler',
      message:
        `The scheduled-scan heartbeat failed: ${error.message}. ` +
        (this.consecutiveTickFailures === 1
          ? 'It will retry in a minute.'
          : `${this.consecutiveTickFailures} consecutive failures — no scheduled scan is running.`),
      errorCode: (error as { code?: string }).code,
      stackTrace: error.stack,
      metadata: { consecutiveFailures: this.consecutiveTickFailures },
      // Once per streak. A notification every minute would train the recipient
      // to ignore exactly the message that matters.
      notify: this.consecutiveTickFailures === 1,
    });
  }

  /**
   * Removes a repeatable registration left by the previous design.
   *
   * Without this, an installation upgrading from that version keeps a zombie
   * repeat config in Redis forever — harmless now that nothing consumes the
   * queue, but it would confuse anyone reading the queue state while debugging.
   */
  private async removeLegacyRepeatable() {
    try {
      for (const job of await this.queue.getRepeatableJobs()) {
        if (job.name === LEGACY_TICK_JOB_NAME) {
          await this.queue.removeRepeatableByKey(job.key);
          this.logger.log('Removed the legacy BullMQ scheduler-tick registration');
        }
      }
    } catch (error) {
      // Redis being unreachable must not stop the scheduler from starting: the
      // heartbeat no longer depends on it.
      this.logger.warn(`Could not clean up the legacy scheduler job: ${(error as Error).message}`);
    }
  }

  /**
   * One pass: repair stale executions, then dispatch everything that is due.
   *
   * Failures of individual schedules are contained — one project with a broken
   * specification must not stop every other schedule in the installation from
   * running.
   */
  async tick(now = new Date()): Promise<TickResult> {
    const startedAt = Date.now();
    const reconciled = await this.reconcileExecutions(now);

    const due = await this.prisma.scheduledScan.findMany({
      where: {
        status: 'ACTIVE',
        nextRunAt: { lte: now },
        /*
         * Never scan a deleted project.
         *
         * Project deletion is a SOFT delete — the row survives so its scans and
         * findings stay readable — which means a schedule attached to it would
         * otherwise keep sending traffic at an API the operator believes they
         * removed. `ProjectsService.remove` also pauses those schedules; this
         * clause is the guarantee, independent of anything remembering to.
         */
        project: { isActive: true },
      },
      // Oldest occurrence first: after an outage the schedule that has been
      // waiting longest is served first.
      orderBy: { nextRunAt: 'asc' },
      take: MAX_DUE_PER_TICK,
    });

    let dispatched = 0;
    let skipped = 0;
    let failed = 0;
    let contended = 0;

    for (const schedule of due) {
      try {
        const result = await this.dispatcher.dispatchDue(schedule, now);
        if (!result.claimed) contended += 1;
        else if (result.skipped) skipped += 1;
        else if (result.assessmentId) dispatched += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Schedule ${schedule.id} could not be dispatched: ${(error as Error).message}`,
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    if (due.length > 0) {
      this.logger.log(
        `Scheduler tick: ${due.length} due, ${dispatched} started, ${skipped} skipped, ` +
          `${failed} failed, ${contended} claimed elsewhere (${durationMs}ms)`,
      );
    }

    return { due: due.length, dispatched, skipped, failed, contended, reconciled, durationMs };
  }

  /**
   * Brings the schedule table back to a consistent state after a restart.
   *
   * Two repairs, both for things a crash can leave behind:
   *
   *  - An ACTIVE schedule with no `nextRunAt` would never be dispatched again.
   *    It cannot happen through the API, but it can through a restored backup
   *    or a hand-edited row, and the symptom — a schedule that quietly stops
   *    scanning — is the worst kind of failure this feature can have.
   *
   *  - Executions left QUEUED or RUNNING by a process that died. Their real
   *    outcome is on the assessment they point at, so it is copied across.
   *
   * Explicitly NOT done here: firing occurrences missed while the service was
   * down. `tick` handles those, one run each, because `nextRunAt` is advanced
   * from the current instant rather than one occurrence at a time.
   */
  async reconcile(now = new Date()): Promise<{ rescheduled: number; executions: number }> {
    const orphaned = await this.prisma.scheduledScan.findMany({
      where: { status: 'ACTIVE', nextRunAt: null },
    });

    let rescheduled = 0;
    for (const schedule of orphaned) {
      const nextRunAt = computeNextRun(toRule(schedule), now);
      await this.prisma.scheduledScan.update({
        where: { id: schedule.id },
        data: nextRunAt ? { nextRunAt } : { status: 'COMPLETED' },
      });
      rescheduled += 1;
    }

    if (rescheduled > 0) {
      this.logger.warn(`Recomputed the next run for ${rescheduled} schedule(s) that had none`);
    }

    const executions = await this.reconcileExecutions(now);
    return { rescheduled, executions };
  }

  /**
   * Copies terminal assessment outcomes onto executions that never heard back.
   *
   * The normal path is the event bus: `scan.completed` and friends update the
   * execution as they happen. This is the safety net for the events that were
   * never delivered because the process holding the listener went away — and
   * for the narrow race where a very fast scan finishes before its execution
   * row has been linked to it.
   */
  private async reconcileExecutions(now: Date): Promise<number> {
    const pending = await this.prisma.scheduleExecution.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: {
        id: true,
        createdAt: true,
        assessmentId: true,
        assessment: { select: { status: true, completedAt: true, currentStep: true } },
      },
      take: 500,
    });

    let repaired = 0;

    for (const execution of pending) {
      const assessmentStatus = execution.assessment?.status;

      if (assessmentStatus && TERMINAL_ASSESSMENT_STATUS[assessmentStatus]) {
        await this.prisma.scheduleExecution.update({
          where: { id: execution.id },
          data: {
            status: TERMINAL_ASSESSMENT_STATUS[assessmentStatus],
            finishedAt: execution.assessment?.completedAt ?? now,
            ...(assessmentStatus === 'FAILED'
              ? { reason: execution.assessment?.currentStep ?? 'The scan failed' }
              : {}),
          },
        });
        repaired += 1;
        continue;
      }

      // No assessment at all, long after the dispatch: the process died between
      // creating this row and creating the scan. Recorded as failed rather than
      // left pending forever, where it would keep `skipIfRunning` from ever
      // letting the schedule run again.
      const isOrphan =
        !execution.assessmentId && now.getTime() - execution.createdAt.getTime() > ORPHAN_DISPATCH_MS;

      if (isOrphan) {
        await this.prisma.scheduleExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILED',
            finishedAt: now,
            reason: 'The service restarted before the scan could be created',
          },
        });
        repaired += 1;
      }
    }

    if (repaired > 0) {
      this.logger.warn(`Reconciled ${repaired} schedule execution(s) left behind by a restart`);
    }

    return repaired;
  }
}

/** Assessment outcomes that end an execution, and what they mean for it. */
const TERMINAL_ASSESSMENT_STATUS: Record<string, 'COMPLETED' | 'FAILED' | 'CANCELLED' | undefined> = {
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};
