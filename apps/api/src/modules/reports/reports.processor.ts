import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReportsService } from './reports.service';
import {
  AutoReportService,
  MAX_GENERATION_ATTEMPTS,
  REPORTS_QUEUE,
  type GenerateReportJob,
} from './auto-report.service';

/**
 * Renders queued reports.
 *
 * Concurrency 2, not 3 like the scanner: each job spawns a Chromium print, and
 * the point of moving this off the scan worker was to stop PDF rendering from
 * competing with scanning for the same slots. Two keeps a backlog moving without
 * letting a burst of finished scans start an unbounded number of browsers.
 */
@Processor(REPORTS_QUEUE, { concurrency: 2 })
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    private reports: ReportsService,
    private autoReports: AutoReportService,
  ) {
    super();
  }

  async process(job: Job<GenerateReportJob>) {
    const { reportId, assessmentId } = job.data;

    const { attempts } = await this.autoReports.markGenerating(reportId);

    try {
      const rendered = await this.reports.renderExisting(reportId);

      await this.autoReports.markCompleted({
        reportId,
        assessmentId,
        projectId: rendered.projectId,
        projectName: rendered.projectName,
        ownerId: rendered.ownerId,
      });

      return { reportId, fileSize: rendered.report.fileSize };
    } catch (error) {
      const reason = (error as Error).message;

      /*
       * Is this the last attempt?
       *
       * `job.attemptsMade` is the count BEFORE this attempt is recorded as
       * failed, so the final try has `attemptsMade === attempts - 1`. Reading
       * the limit off the job rather than the constant keeps this correct if a
       * job was enqueued under a different policy.
       */
      const limit = job.opts.attempts ?? MAX_GENERATION_ATTEMPTS;
      const isFinalAttempt = job.attemptsMade + 1 >= limit;

      if (isFinalAttempt) {
        // Terminal. Record it, tell the user, and let the job fail so BullMQ
        // files it as failed rather than pretending it succeeded.
        await this.autoReports.markFailed({
          reportId,
          assessmentId,
          reason,
          attempts,
        });
      } else {
        this.logger.warn(
          `[Reports] Attempt ${job.attemptsMade + 1}/${limit} failed for report ${reportId}; ` +
            `retrying with backoff. ${reason}`,
        );
      }

      // Rethrown either way: this is what drives the retry, and on the final
      // attempt it is what stops a failed render being reported as a success.
      throw error;
    }
  }
}
