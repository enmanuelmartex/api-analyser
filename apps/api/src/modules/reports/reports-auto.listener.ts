import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutoReportService } from './auto-report.service';
import type { ScanCompletedEvent } from '../events/domain-events';

/**
 * Turns a finished scan into a queued PDF.
 *
 * The whole reason automatic reports work identically for a manual run and a
 * 3 a.m. scheduled one: both end by emitting `scan.completed`, and this is the
 * only thing listening for the purpose of generating a report. There is no
 * second implementation for schedules to drift out of step with.
 *
 * Nothing here renders anything. It claims the row and returns, so the event
 * emitter — which runs handlers on the emitter's own tick — is never blocked
 * behind a Chromium print.
 */
@Injectable()
export class ReportsAutoListener {
  private readonly logger = new Logger(ReportsAutoListener.name);

  constructor(private autoReports: AutoReportService) {}

  @OnEvent('scan.completed')
  async onScanCompleted(payload: ScanCompletedEvent) {
    try {
      await this.autoReports.claimAndQueue(payload.assessmentId);
    } catch (error) {
      /*
       * A failure to queue must never propagate back into the scan.
       *
       * This handler runs on the tick of the worker that just finished the
       * assessment. Throwing here would surface as a failed scan job — the scan
       * would be retried, and the user would be told their completed scan
       * failed, because the report queue was briefly unreachable.
       */
      this.logger.error(
        `[Reports] Could not queue the automatic report for ${payload.assessmentId}: ` +
          `${(error as Error).message}`,
      );
    }
  }
}
