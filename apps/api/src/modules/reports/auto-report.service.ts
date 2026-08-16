import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { GENERATOR_VERSION, type ReportFormat, type ReportType } from './report-artifact';

/** The queue the PDF worker consumes. */
export const REPORTS_QUEUE = 'reports';

/** The one job name on it. */
export const GENERATE_REPORT_JOB = 'generate-report';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * How many times a render is attempted before the report is declared failed.
 *
 * Three, with exponential backoff, because the failures this recovers from are
 * transient by nature — Chromium losing a socket, the storage volume briefly
 * full, a database blip. A malformed report fails identically three times and
 * then stops, which is the point: there is no infinite loop here, and the third
 * failure produces a FAILED row and a notification rather than silence.
 */
export const MAX_GENERATION_ATTEMPTS = 3;

/** The artifact every completed scan is owed. */
const AUTOMATIC_TYPE: ReportType = 'TECHNICAL';
const AUTOMATIC_FORMAT: ReportFormat = 'PDF';

export interface GenerateReportJob {
  reportId: string;
  assessmentId: string;
}

/**
 * Issues the automatic PDF for a completed scan.
 *
 * Split into a claim and a render, deliberately:
 *
 *   1. `claim` inserts a PENDING row inside the request/event that observed the
 *      scan finish. It is cheap, it is idempotent, and it is what makes the
 *      report visible as "generating" immediately.
 *   2. The queue renders it. That is the expensive part — a Chromium print —
 *      and it must not run on the scan worker, which is what it used to do.
 *
 * The idempotency guarantee lives in the database, not here: `autoKey` is a
 * unique column holding the assessment id, so a redelivered `scan.completed`
 * loses the insert race and enqueues nothing. Two workers, two processes and a
 * retried event all converge on one report.
 */
@Injectable()
export class AutoReportService {
  private readonly logger = new Logger(AutoReportService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    @InjectQueue(REPORTS_QUEUE) private queue: Queue<GenerateReportJob>,
  ) {}

  /**
   * Claims the automatic report for a scan and queues its render.
   *
   * Returns the report id when this call is the one that claimed it, and null
   * when the report already existed — which is the normal outcome of a
   * redelivered event and is not an error.
   */
  async claimAndQueue(assessmentId: string): Promise<string | null> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        status: true,
        project: { select: { id: true, name: true, userId: true } },
      },
    });

    if (!assessment) {
      this.logger.warn(`[Reports] No assessment ${assessmentId}; nothing to generate.`);
      return null;
    }

    // Only a scan that actually succeeded is owed a report. A cancelled or
    // failed run has nothing meaningful to render, and generating one would
    // hand the user a document describing a scan that never finished.
    if (assessment.status !== 'COMPLETED') {
      this.logger.log(
        `[Reports] Skipping auto-report for ${assessmentId}: status is ${assessment.status}.`,
      );
      return null;
    }

    const ownerId = assessment.project.userId;
    const projectName = assessment.project.name;

    let reportId: string;
    try {
      const created = await this.prisma.report.create({
        data: {
          assessmentId,
          type: AUTOMATIC_TYPE as any,
          format: AUTOMATIC_FORMAT as any,
          version: 1,
          title: this.buildTitle(projectName),
          kind: 'AUTOMATIC_SCAN_REPORT',
          status: 'PENDING',
          requestedById: ownerId,
          // The idempotency guard. Unique, so the second caller for this scan
          // raises P2002 below instead of inserting a second PDF.
          autoKey: assessmentId,
          generatorVersion: GENERATOR_VERSION,
        } as any,
        select: { id: true },
      });
      reportId = created.id;
    } catch (error: any) {
      if (error?.code === UNIQUE_VIOLATION) {
        // Already claimed. Either by a redelivered event — in which case the
        // original job is queued or done and there is nothing to do — or by a
        // manual export that got there first, whose row is `MANUAL_EXPORT` with
        // a null autoKey and therefore cannot be the one that collided.
        this.logger.log(
          `[Reports] Automatic report for ${assessmentId} already exists; not queueing a duplicate.`,
        );
        return null;
      }
      throw error;
    }

    this.logger.log(`[Reports] Auto-generating PDF for scan ${assessmentId} (report ${reportId})`);

    await this.queue.add(
      GENERATE_REPORT_JOB,
      { reportId, assessmentId },
      {
        // `jobId` makes the enqueue itself idempotent too. The row insert above
        // already prevents duplicates, but a crash between insert and enqueue
        // followed by a manual retry must not stack two jobs on one report.
        //
        // Hyphen, not colon: BullMQ uses `:` to separate the segments of its own
        // Redis keys and rejects a custom id containing one — "Custom Id cannot
        // contain :". It throws at `add`, so a colon here does not produce a
        // slow queue, it produces a report that is claimed in the database and
        // never rendered, and therefore an email that is never sent.
        jobId: `report-${reportId}`,
        attempts: MAX_GENERATION_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );

    return reportId;
  }

  /** Moves a claimed report into GENERATING and counts the attempt. */
  async markGenerating(reportId: string) {
    return this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'GENERATING', attempts: { increment: 1 } } as any,
      select: { id: true, attempts: true },
    });
  }

  /**
   * Records a successful render and announces it.
   *
   * The event is emitted here and nowhere else on this path, strictly after the
   * row reaches COMPLETED — which is what lets every consumer treat
   * `report.generated` as "the bytes exist". The email pipeline depends on
   * exactly that: it attaches the stored PDF rather than rendering its own.
   */
  async markCompleted(input: {
    reportId: string;
    assessmentId: string;
    projectId: string;
    projectName: string;
    ownerId: string;
  }) {
    await this.prisma.report.update({
      where: { id: input.reportId },
      // `error` is cleared: a report that failed twice and succeeded on the
      // third attempt must not still show the second attempt's message.
      data: { status: 'COMPLETED', error: null, generatedAt: new Date() } as any,
    });

    this.logger.log(`[Reports] PDF report ${input.reportId} generated successfully`);

    this.events.emit('report.generated', {
      reportId: input.reportId,
      assessmentId: input.assessmentId,
      projectId: input.projectId,
      projectName: input.projectName,
      userId: input.ownerId,
      reportType: AUTOMATIC_TYPE,
      format: AUTOMATIC_FORMAT,
      kind: 'AUTOMATIC_SCAN_REPORT',
    });
  }

  /**
   * Records a terminal failure and announces it.
   *
   * Only called once BullMQ has exhausted every attempt. An intermediate failure
   * leaves the row GENERATING and says nothing, because the retry will probably
   * succeed and telling the user about a problem that resolves itself thirty
   * seconds later is noise.
   */
  async markFailed(input: {
    reportId: string;
    assessmentId: string;
    reason: string;
    attempts: number;
  }) {
    const report = await this.prisma.report
      .update({
        where: { id: input.reportId },
        data: { status: 'FAILED', error: this.truncate(input.reason) } as any,
        select: {
          id: true,
          type: true,
          format: true,
          assessment: { select: { project: { select: { id: true, name: true, userId: true } } } },
        },
      })
      .catch((error) => {
        this.logger.error(
          `[Reports] Could not record failure for report ${input.reportId}: ${(error as Error).message}`,
        );
        return null;
      });

    if (!report) return;

    this.logger.error(
      `[Reports] PDF generation failed permanently for report ${input.reportId} ` +
        `after ${input.attempts} attempt(s): ${input.reason}`,
    );

    this.events.emit('report.failed', {
      reportId: input.reportId,
      assessmentId: input.assessmentId,
      projectId: report.assessment.project.id,
      projectName: report.assessment.project.name,
      userId: report.assessment.project.userId,
      reportType: report.type,
      format: report.format,
      kind: 'AUTOMATIC_SCAN_REPORT',
      reason: input.reason,
      attempts: input.attempts,
    });
  }

  private buildTitle(projectName: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `Technical report — ${projectName} — ${date}`;
  }

  /** Keeps a stack trace or provider dump from becoming the whole column. */
  private truncate(reason: string): string {
    return reason.length > 500 ? `${reason.slice(0, 497)}...` : reason;
  }
}
