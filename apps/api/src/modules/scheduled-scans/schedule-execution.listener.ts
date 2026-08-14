import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ScheduleExecutionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ScanCancelledEvent,
  ScanCompletedEvent,
  ScanFailedEvent,
  ScanStartedEvent,
} from '../events/domain-events';

/**
 * Keeps a schedule's execution row in step with the scan it started.
 *
 * Driven by the same `scan.*` events the audit writer and the notification
 * dispatcher consume, which is what keeps scheduling out of the scanner: the
 * worker emits that a scan finished and knows nothing about schedules, and this
 * listener translates that into "the 02:00 occurrence completed".
 *
 * Every handler is a no-op for a manual scan — `updateMany` on a nonexistent
 * `assessmentId` simply matches nothing — so no branch is needed to tell the
 * two apart, and a scan that was never scheduled cannot be mislabelled.
 *
 * Failures are swallowed on purpose. These handlers run on the emitting tick,
 * so throwing here would surface as a failure of the scan itself.
 */
@Injectable()
export class ScheduleExecutionListener {
  private readonly logger = new Logger(ScheduleExecutionListener.name);

  constructor(private prisma: PrismaService) {}

  @OnEvent('scan.started')
  async onScanStarted(payload: ScanStartedEvent) {
    await this.transition(payload.assessmentId, {
      status: 'RUNNING',
      startedAt: new Date(),
    });
  }

  @OnEvent('scan.completed')
  async onScanCompleted(payload: ScanCompletedEvent) {
    await this.transition(payload.assessmentId, {
      status: 'COMPLETED',
      finishedAt: new Date(),
    });
  }

  @OnEvent('scan.failed')
  async onScanFailed(payload: ScanFailedEvent) {
    await this.transition(payload.assessmentId, {
      status: 'FAILED',
      finishedAt: new Date(),
      reason: payload.reason,
    });
  }

  @OnEvent('scan.cancelled')
  async onScanCancelled(payload: ScanCancelledEvent) {
    await this.transition(payload.assessmentId, {
      status: 'CANCELLED',
      finishedAt: new Date(),
      reason: 'The scan was cancelled by an operator',
    });
  }

  /**
   * Moves the execution for one assessment, if there is one.
   *
   * Scoped to non-terminal executions so a late or replayed event cannot
   * reopen a finished one — BullMQ can redeliver, and the reconciliation sweep
   * may already have recorded the outcome from the assessment row.
   */
  private async transition(
    assessmentId: string,
    data: {
      status: ScheduleExecutionStatus;
      startedAt?: Date;
      finishedAt?: Date;
      reason?: string;
    },
  ) {
    try {
      await this.prisma.scheduleExecution.updateMany({
        where: { assessmentId, status: { in: ['QUEUED', 'RUNNING'] } },
        data,
      });
    } catch (error) {
      this.logger.error(
        `Could not update the schedule execution for assessment ${assessmentId}: ${(error as Error).message}`,
      );
    }
  }
}
