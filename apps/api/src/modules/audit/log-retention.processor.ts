import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { LogRetentionService, RETENTION_QUEUE } from './log-retention.service';

/**
 * Runs the scheduled retention pass.
 *
 * Concurrency is left at the default of 1: two cleanups deleting from the same
 * table at once would contend for the same rows and gain nothing, since the
 * work is IO-bound on Postgres either way.
 */
@Processor(RETENTION_QUEUE)
export class LogRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(LogRetentionProcessor.name);

  constructor(private retention: LogRetentionService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.debug(`Running scheduled log retention (job ${job.id})`);
    // Failures propagate so BullMQ retries with the configured backoff rather
    // than recording a successful run that deleted nothing.
    return this.retention.runNow('scheduled');
  }
}
