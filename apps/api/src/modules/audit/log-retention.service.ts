import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { AuditService } from './audit.service';
import { NotificationsRetentionPort } from './notifications-retention.port';
import { SettingsService } from '../settings/settings.service';

export interface RetentionResult {
  deletedByAge: number;
  deletedByCount: number;
  deletedNotifications: number;
  total: number;
  cutoff: Date | null;
  skipped: boolean;
  reason?: string;
  durationMs: number;
}

export const RETENTION_QUEUE = 'log-retention';
const REPEATABLE_JOB_NAME = 'scheduled-cleanup';

/**
 * Enforces the log retention policy.
 *
 * Scheduled through BullMQ's repeatable jobs rather than a new scheduler.
 * `@nestjs/schedule` is not a dependency of this project and adding it would
 * put a second, in-process timer next to the queue infrastructure that already
 * exists — and an in-process timer runs once per API replica, so the cleanup
 * would race with itself the moment the API is scaled. A repeatable job is
 * stored in Redis and delivered to exactly one worker.
 */
@Injectable()
export class LogRetentionService implements OnModuleInit {
  private readonly logger = new Logger(LogRetentionService.name);

  constructor(
    @InjectQueue(RETENTION_QUEUE) private queue: Queue,
    private audit: AuditService,
    private settings: SettingsService,
    private notifications: NotificationsRetentionPort,
  ) {}

  async onModuleInit() {
    await this.reschedule().catch((err) =>
      // A missing Redis must not stop the API from booting. Cleanup can still be
      // triggered by hand from Log Management.
      this.logger.warn(`Could not schedule log retention: ${err.message}`),
    );
  }

  /**
   * Re-registers the repeatable job to match the configured interval.
   *
   * BullMQ keys a repeatable job by its pattern, so changing the interval
   * without removing the old registration leaves both schedules live — the
   * cleanup would then run on the old cadence forever. Every previous
   * registration is therefore removed first.
   */
  @OnEvent('settings.changed')
  async reschedule() {
    const enabled = await this.settings.getBoolean('logs.retentionEnabled');
    const hours = await this.settings.getNumber('logs.cleanupIntervalHours');

    for (const job of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    if (!enabled) {
      this.logger.log('Log retention is disabled; no cleanup scheduled');
      return;
    }

    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { every: hours * 60 * 60 * 1000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
        // A fixed id keeps a restart from stacking duplicate registrations.
        jobId: REPEATABLE_JOB_NAME,
      },
    );

    this.logger.log(`Log retention scheduled every ${hours}h`);
  }

  /**
   * Applies the policy now.
   *
   * `trigger` distinguishes the scheduled run from an operator pressing "Run
   * cleanup now", because the resulting audit event should say which it was.
   */
  async runNow(trigger: 'scheduled' | 'manual', actorId?: string): Promise<RetentionResult> {
    const startedAt = Date.now();
    const enabled = await this.settings.getBoolean('logs.retentionEnabled');

    if (!enabled && trigger === 'scheduled') {
      return {
        deletedByAge: 0,
        deletedByCount: 0,
        deletedNotifications: 0,
        total: 0,
        cutoff: null,
        skipped: true,
        reason: 'Retention is disabled',
        durationMs: Date.now() - startedAt,
      };
    }

    const days = await this.settings.getNumber('logs.retentionDays');
    const maxRecords = await this.settings.getNumber('logs.maxRecords');
    const notificationDays = await this.settings.getNumber('notifications.retentionDays');

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deletedByAge = await this.audit.deleteOlderThan(cutoff);
    const deletedByCount = await this.audit.enforceMaxRecords(maxRecords);
    const deletedNotifications = await this.notifications.deleteReadOlderThan(
      new Date(Date.now() - notificationDays * 24 * 60 * 60 * 1000),
    );

    const total = deletedByAge + deletedByCount;
    const durationMs = Date.now() - startedAt;

    /*
     * The cleanup records itself.
     *
     * Written after the deletes and in the CONFIGURATION category, which is
     * always collected — so the one event explaining why a chunk of history is
     * missing can never be removed by the same policy that removed it, nor
     * suppressed by turning collection off.
     */
    await this.audit.record({
      event: 'logs.retention.executed',
      category: 'CONFIGURATION',
      severity: total > 0 ? 'INFO' : 'DEBUG',
      status: 'SUCCESS',
      resource: 'audit_log',
      source: 'retention',
      userId: actorId,
      message:
        total > 0
          ? `Retention removed ${total.toLocaleString()} event${total === 1 ? '' : 's'}`
          : 'Retention ran with nothing to remove',
      durationMs,
      metadata: {
        trigger,
        retentionDays: days,
        maxRecords,
        cutoff: cutoff.toISOString(),
        deletedByAge,
        deletedByCount,
        deletedNotifications,
      },
    });

    this.logger.log(
      `Retention (${trigger}): ${deletedByAge} by age, ${deletedByCount} over limit, ${deletedNotifications} notifications, in ${durationMs}ms`,
    );

    return {
      deletedByAge,
      deletedByCount,
      deletedNotifications,
      total,
      cutoff,
      skipped: false,
      durationMs,
    };
  }
}
