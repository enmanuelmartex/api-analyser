import { describe, expect, it } from 'bun:test';
import { ReportsProcessor } from './reports.processor';

/**
 * What the worker does with a render that fails.
 *
 * The distinction under test is between an intermediate failure — retried,
 * silent, usually recovered — and the last one, which must produce a FAILED row
 * and a notification. Getting this wrong in either direction is bad: notifying
 * on every attempt is noise, and never notifying leaves a missing report
 * indistinguishable from one that was never owed.
 */

function makeProcessor(options: { renderFails?: string } = {}) {
  const completed: any[] = [];
  const failed: any[] = [];
  const generating: string[] = [];

  const reports = {
    renderExisting: async (reportId: string) => {
      if (options.renderFails) throw new Error(options.renderFails);
      return {
        report: { id: reportId, fileSize: 51_200 },
        projectId: 'proj_1',
        projectName: 'Production API',
        ownerId: 'user_1',
      };
    },
  };

  const autoReports = {
    markGenerating: async (reportId: string) => {
      generating.push(reportId);
      return { id: reportId, attempts: generating.length };
    },
    markCompleted: async (input: any) => {
      completed.push(input);
    },
    markFailed: async (input: any) => {
      failed.push(input);
    },
  };

  const processor = new ReportsProcessor(reports as any, autoReports as any);

  return { processor, completed, failed, generating };
}

/** A BullMQ job stand-in: only the fields the processor reads. */
function makeJob(attemptsMade: number, attempts = 3) {
  return {
    data: { reportId: 'report_1', assessmentId: 'scan_123' },
    attemptsMade,
    opts: { attempts },
  } as any;
}

describe('ReportsProcessor', () => {
  it('renders and completes the report on a successful attempt', async () => {
    const { processor, completed, failed, generating } = makeProcessor();

    const result = await processor.process(makeJob(0));

    expect(generating).toEqual(['report_1']);
    expect(completed).toHaveLength(1);
    expect(completed[0].projectName).toBe('Production API');
    expect(failed).toHaveLength(0);
    expect(result).toEqual({ reportId: 'report_1', fileSize: 51_200 });
  });

  /**
   * The first two failures say nothing.
   *
   * The job is rethrown so BullMQ retries it with backoff, but no FAILED row is
   * written and no notification is raised — the retry usually succeeds, and
   * telling the user about a problem that resolves itself is noise.
   */
  it('rethrows without recording a failure while retries remain', async () => {
    const { processor, failed } = makeProcessor({ renderFails: 'Chromium timed out' });

    expect(processor.process(makeJob(0))).rejects.toThrow('Chromium timed out');
    await processor.process(makeJob(0)).catch(() => {});

    expect(failed).toHaveLength(0);
  });

  it('records the failure on the final attempt', async () => {
    const { processor, failed, completed } = makeProcessor({ renderFails: 'Chromium timed out' });

    // attemptsMade is 2 before the third and last attempt is recorded.
    await processor.process(makeJob(2)).catch(() => {});

    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBe('Chromium timed out');
    expect(failed[0].reportId).toBe('report_1');
    // Never completed. A failed render must not be recorded as a finished
    // report, which is what would make the product email a link to nothing.
    expect(completed).toHaveLength(0);
  });

  it('still rethrows on the final attempt, so the job is filed as failed', async () => {
    const { processor } = makeProcessor({ renderFails: 'Chromium timed out' });

    expect(processor.process(makeJob(2))).rejects.toThrow('Chromium timed out');
  });

  it('honours the job‘s own attempt limit rather than the default', async () => {
    const { processor, failed } = makeProcessor({ renderFails: 'boom' });

    // A job enqueued with a single attempt is terminal immediately.
    await processor.process(makeJob(0, 1)).catch(() => {});

    expect(failed).toHaveLength(1);
  });
});
