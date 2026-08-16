import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { zonedPartsOf } from '../scheduled-scans/recurrence/zoned-time';
import { EMAIL_QUEUE, type EmailJob } from './email.jobs';
import { EmailService } from './email.service';
import { weeklyDeliveryKey } from './report-recipients';
import { lastCompleteWeek } from './week-range';

/**
 * How often the scheduler looks for users whose digest is due.
 *
 * Fifteen minutes, not one. The digest is a weekly message with no deadline
 * finer than "Monday morning", and the tick's only job is to notice that a
 * user's local Monday has reached the send hour. A minute-resolution tick would
 * do the same work sixty times as often for no observable difference.
 */
const TICK_INTERVAL_MS = 15 * 60_000;

/** Users considered per tick, so a large install cannot stall the loop. */
const MAX_USERS_PER_TICK = 500;

/** Local hour, on Monday, at which the digest becomes due. */
const DEFAULT_SEND_HOUR = 8;

export interface WeeklyTickResult {
  considered: number;
  queued: number;
  skipped: number;
  durationMs: number;
}

/**
 * The clock behind the weekly digest.
 *
 * ── Why an in-process interval, and NOT a BullMQ repeatable job ─────────────
 *
 * Because this codebase already learned that lesson the expensive way. See the
 * long note on `SchedulerService`: a repeatable job's id is derived from its
 * slot, a restart inside the same slot collides with the completed job, and the
 * chain that would have scheduled the next tick is never extended — so the
 * scheduler stops permanently, silently, and looks healthy while doing it.
 * Building a second scheduler on the mechanism that failed would be repeating
 * a known-bad decision for the sake of symmetry.
 *
 * A timer per API replica is fine here for exactly the reason it is fine there:
 * correctness does not depend on the timer being singular. Every layer below is
 * idempotent, so ten replicas ticking at once produce one email.
 *
 * ── The three layers that make a duplicate impossible ───────────────────────
 *
 *  1. **This scheduler checks `EmailDelivery` before enqueueing.** Cheap, and
 *     it keeps the queue empty on the other 95 ticks of the day. Not a
 *     guarantee on its own — two replicas can both pass the check.
 *  2. **A deterministic `jobId`.** BullMQ discards a second job with the same
 *     id while the first is still in the queue.
 *  3. **The unique `idempotencyKey` on the delivery row**, claimed by
 *     `EmailService.send` BEFORE the transport is called. This is the durable
 *     guarantee: two workers racing on the same key both attempt the insert and
 *     exactly one wins, so the loser sends nothing.
 *
 * Layer 3 alone is sufficient. Layers 1 and 2 exist so that the normal case
 * does no wasted work.
 *
 * ── Why eligibility is "on or after Monday 08:00" rather than "at" ──────────
 *
 * An install that is down all Monday would otherwise silently skip that week
 * forever. The window instead stays open for the rest of the week, and the
 * idempotency key — which is keyed on the reported week, not on the send date —
 * means catching up on Wednesday still sends exactly one digest, for the right
 * week. Recovery is automatic and needs no backfill command.
 */
@Injectable()
export class WeeklySummaryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklySummaryScheduler.name);

  private timer?: ReturnType<typeof setInterval>;
  /** Guards against a slow tick overlapping the next one. */
  private ticking = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private preferences: NotificationPreferencesService,
    private email: EmailService,
    @InjectQueue(EMAIL_QUEUE) private queue: Queue<EmailJob>,
  ) {}

  onModuleInit() {
    if (!this.enabled()) {
      this.logger.log('[Weekly] Disabled by configuration; no digest will be sent.');
      return;
    }

    if (!this.email.isConfigured()) {
      // Not an error, and not fatal. Email is an addition to this product: with
      // no transport the digest simply has nowhere to go, and every other
      // feature is unaffected.
      this.logger.log(
        '[Weekly] No email transport is configured; the weekly digest is inactive.',
      );
      return;
    }

    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        // Never propagates: an unhandled rejection inside a timer would take
        // down the process, and a failed tick must only mean a late digest.
        this.logger.error(`[Weekly] Tick failed: ${(error as Error).message}`);
      });
    }, TICK_INTERVAL_MS);

    // `unref` so a pending timer cannot hold the process open during shutdown.
    this.timer.unref?.();

    this.logger.log(
      `[Weekly] Digest scheduler started; checking every ${TICK_INTERVAL_MS / 60_000} minutes ` +
        `for users whose local Monday has reached ${this.sendHour()}:00.`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass: find users whose digest is due and queue it.
   *
   * Public so it can be driven directly by a test and by an operator's manual
   * trigger, rather than only by the timer.
   */
  async tick(now: Date = new Date()): Promise<WeeklyTickResult> {
    if (this.ticking) {
      return { considered: 0, queued: 0, skipped: 0, durationMs: 0 };
    }
    this.ticking = true;

    const startedAt = Date.now();
    let considered = 0;
    let queued = 0;
    let skipped = 0;

    try {
      const candidates = await this.prisma.user.findMany({
        /*
         * An inactive account has nowhere to receive a digest, and filtering it
         * in the query rather than in the loop keeps a large install of
         * deactivated users free.
         *
         * There is deliberately no `email: { not: null }` beside it. `email` is
         * `String @unique` — required — and Prisma rejects a null comparison on
         * a non-nullable column outright: "Argument `not` must not be null".
         * That threw on every tick, so the digest never went out at all. A row
         * with no address cannot exist; the empty-string guard in the loop
         * below is what covers the only degenerate value the column allows.
         */
        where: { isActive: true },
        select: { id: true, email: true, timeZone: true },
        take: MAX_USERS_PER_TICK,
        orderBy: { createdAt: 'asc' },
      });

      for (const user of candidates) {
        considered += 1;

        if (!user.email) {
          skipped += 1;
          continue;
        }

        const timeZone = user.timeZone || this.systemTimeZone();
        if (!this.isDue(now, timeZone)) {
          skipped += 1;
          continue;
        }

        if (!(await this.preferences.wantsWeeklySummary(user.id))) {
          skipped += 1;
          continue;
        }

        const week = lastCompleteWeek(now, timeZone);
        const key = weeklyDeliveryKey(week.fromDate, user.email);

        // Layer 1. The unique index is still the guarantee; this only avoids
        // enqueueing a job that would immediately discover it has nothing to do.
        if (await this.email.alreadySent(key)) {
          skipped += 1;
          continue;
        }

        const enqueued = await this.enqueue(user.id, week.fromDate);
        if (enqueued) queued += 1;
        else skipped += 1;
      }

      if (queued > 0) {
        this.logger.log(
          `[Weekly] Queued ${queued} digest(s) from ${considered} active user(s).`,
        );
      }

      return { considered, queued, skipped, durationMs: Date.now() - startedAt };
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Has this user's local clock passed Monday's send hour for the current week?
   *
   * True for the whole of Monday after the hour, and for every day after that
   * until the next Monday — see the class note on why the window stays open.
   */
  private isDue(now: Date, timeZone: string): boolean {
    const parts = zonedPartsOf(now, timeZone);
    const daysSinceMonday = (parts.weekday + 6) % 7;

    if (daysSinceMonday > 0) return true;
    return parts.hour >= this.sendHour();
  }

  /**
   * Adds the job under a deterministic id.
   *
   * Returns false rather than throwing when the queue is unreachable: this runs
   * on a timer, and Redis being briefly down must mean a late digest rather
   * than a crashed tick. The next tick tries again, and the idempotency key
   * makes that safe.
   */
  private async enqueue(userId: string, weekStart: string): Promise<boolean> {
    try {
      await this.queue.add(
        'weekly-summary',
        { type: 'weekly-summary', userId, weekStart },
        {
          // Layer 2. Hyphens, not colons: BullMQ uses `:` to separate the
          // segments of its own Redis keys and rejects a custom id containing
          // one — the same trap documented on `AutoReportService`.
          jobId: `weekly-${userId}-${weekStart}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[Weekly] Could not queue the digest for ${userId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private enabled(): boolean {
    return this.config.get<boolean>('email.weeklySummaryEnabled') !== false;
  }

  private sendHour(): number {
    const configured = this.config.get<number>('email.weeklySummaryHour');
    if (typeof configured !== 'number' || !Number.isFinite(configured)) return DEFAULT_SEND_HOUR;
    return Math.min(Math.max(Math.trunc(configured), 0), 23);
  }

  private systemTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
}
