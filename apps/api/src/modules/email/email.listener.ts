import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, type EmailJob } from './email.jobs';
import type { ReportGeneratedEvent, ScanFailedEvent } from '../events/domain-events';

/**
 * Decides which events are worth an email, and queues one.
 *
 * Note what it listens to and what it does not:
 *
 *   • `report.generated` — NOT `scan.completed`. This is the ordering
 *     requirement made structural: the "your report is ready" email can only be
 *     queued by an event that is emitted after the PDF is on disk, so there is
 *     no code path that announces a report before it exists. A scan that
 *     completes but whose report fails produces no report email at all — the
 *     user gets the in-app REPORT_FAILED notification instead.
 *
 *   • `scan.failed` — a failed scan has no report to wait for, so it queues
 *     directly.
 *
 * Nothing is sent from here. The handler enqueues and returns, because it runs
 * on the emitter's tick and an HTTP call to a mail provider does not belong
 * there.
 */
@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(@InjectQueue(EMAIL_QUEUE) private queue: Queue<EmailJob>) {}

  @OnEvent('report.generated')
  async onReportGenerated(payload: ReportGeneratedEvent) {
    // Only the automatic report mails anybody. A hand-requested SARIF export is
    // something the user is already looking at; mailing it would be a surprise.
    if (payload.kind !== 'AUTOMATIC_SCAN_REPORT') return;
    if (!payload.userId) return;

    await this.enqueue(
      {
        type: 'scan-report-ready',
        reportId: payload.reportId,
        assessmentId: payload.assessmentId,
        userId: payload.userId,
      },
      `report-ready:${payload.reportId}`,
    );
  }

  @OnEvent('scan.failed')
  async onScanFailed(payload: ScanFailedEvent) {
    if (!payload.userId) return;

    await this.enqueue(
      {
        type: 'scan-failed',
        assessmentId: payload.assessmentId,
        userId: payload.userId,
        reason: payload.reason,
        scheduleName: payload.scheduleName,
      },
      `scan-failed:${payload.assessmentId}`,
    );
  }

  /**
   * Adds the job under a deterministic `jobId`.
   *
   * A second job with the same id is discarded by BullMQ while the first is
   * still in the queue, which stops a redelivered event from queueing twice.
   * The durable guarantee is still the unique `idempotencyKey` on the delivery
   * row — this only avoids the wasted work of assembling a message that would
   * then be discarded.
   */
  private async enqueue(job: EmailJob, jobId: string) {
    try {
      await this.queue.add(job.type, job, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      });
    } catch (error) {
      // Never propagates: this runs on the tick of the worker that generated
      // the report, and an unreachable Redis must not turn a successful report
      // into a failed job.
      this.logger.error(`[Email] Could not queue ${job.type}: ${(error as Error).message}`);
    }
  }
}
