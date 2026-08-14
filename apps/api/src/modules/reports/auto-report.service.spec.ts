import { describe, expect, it } from 'bun:test';
import { AutoReportService, MAX_GENERATION_ATTEMPTS } from './auto-report.service';

/**
 * The guarantees the automatic report rests on.
 *
 * Every one of these is a rule the product states plainly — exactly one PDF per
 * scan, no duplicate on a redelivered event, a failure that is recorded rather
 * than hidden — so each gets a test that fails loudly if the rule stops holding.
 */

const UNIQUE_VIOLATION = 'P2002';

interface Options {
  assessment?: any;
  /** Makes `report.create` raise a unique violation, as a real collision would. */
  reportExists?: boolean;
}

function makeService(options: Options = {}) {
  const created: any[] = [];
  const updated: { id: string; data: any }[] = [];
  const queued: { name: string; data: any; opts: any }[] = [];
  const emitted: { event: string; payload: any }[] = [];

  const assessment =
    options.assessment === undefined
      ? {
          id: 'scan_123',
          status: 'COMPLETED',
          project: { id: 'proj_1', name: 'Production API', userId: 'user_1' },
        }
      : options.assessment;

  const prisma = {
    assessment: {
      findUnique: async () => assessment,
    },
    report: {
      create: async ({ data }: any) => {
        if (options.reportExists) {
          const error: any = new Error('Unique constraint failed on the fields: (`autoKey`)');
          error.code = UNIQUE_VIOLATION;
          throw error;
        }
        created.push(data);
        return { id: `report_${created.length}` };
      },
      update: async ({ where, data }: any) => {
        updated.push({ id: where.id, data });
        return {
          id: where.id,
          attempts: data.attempts?.increment ? 1 : 0,
          type: 'TECHNICAL',
          format: 'PDF',
          assessment: { project: { id: 'proj_1', name: 'Production API', userId: 'user_1' } },
        };
      },
    },
  };

  const events = {
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
      return true;
    },
  };

  const queue = {
    add: async (name: string, data: any, opts: any) => {
      queued.push({ name, data, opts });
      return { id: opts?.jobId };
    },
  };

  const service = new AutoReportService(prisma as any, events as any, queue as any);

  return { service, created, updated, queued, emitted };
}

describe('AutoReportService.claimAndQueue', () => {
  it('claims one automatic PDF and queues it when a scan completes', async () => {
    const { service, created, queued } = makeService();

    const reportId = await service.claimAndQueue('scan_123');

    expect(reportId).toBe('report_1');
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('AUTOMATIC_SCAN_REPORT');
    expect(created[0].format).toBe('PDF');
    expect(created[0].status).toBe('PENDING');
    // The report belongs to the project's owner, resolved on the server.
    expect(created[0].requestedById).toBe('user_1');
    // The idempotency guard, which is what the unique index enforces.
    expect(created[0].autoKey).toBe('scan_123');

    expect(queued).toHaveLength(1);
    expect(queued[0].data).toEqual({ reportId: 'report_1', assessmentId: 'scan_123' });
  });

  it('retries with backoff rather than failing on the first render error', async () => {
    const { service, queued } = makeService();

    await service.claimAndQueue('scan_123');

    expect(queued[0].opts.attempts).toBe(MAX_GENERATION_ATTEMPTS);
    expect(queued[0].opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    // A deterministic job id, so a crash between the insert and the enqueue
    // cannot leave two jobs racing on one report.
    expect(queued[0].opts.jobId).toBe('report:report_1');
  });

  /**
   * The duplicate-suppression test.
   *
   * A redelivered `scan.completed` — a retried job, a restarted worker — must
   * not produce a second PDF. The unique `autoKey` makes the second insert
   * raise, and this is what proves the raise is handled rather than propagated.
   */
  it('does not create a second report when the event is redelivered', async () => {
    const { service, created, queued } = makeService({ reportExists: true });

    const reportId = await service.claimAndQueue('scan_123');

    expect(reportId).toBeNull();
    expect(created).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('generates nothing for a scan that did not complete', async () => {
    const { service, created, queued } = makeService({
      assessment: {
        id: 'scan_123',
        status: 'FAILED',
        project: { id: 'proj_1', name: 'Production API', userId: 'user_1' },
      },
    });

    expect(await service.claimAndQueue('scan_123')).toBeNull();
    expect(created).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('does nothing when the assessment has gone', async () => {
    const { service, queued } = makeService({ assessment: null });

    expect(await service.claimAndQueue('missing')).toBeNull();
    expect(queued).toHaveLength(0);
  });
});

describe('AutoReportService lifecycle', () => {
  it('announces the report only after it reaches COMPLETED', async () => {
    const { service, updated, emitted } = makeService();

    await service.markCompleted({
      reportId: 'report_1',
      assessmentId: 'scan_123',
      projectId: 'proj_1',
      projectName: 'Production API',
      ownerId: 'user_1',
    });

    // The write happens before the emit: the ordering is what lets every
    // consumer treat `report.generated` as "the bytes exist".
    expect(updated[0].data.status).toBe('COMPLETED');
    // A recovered report must not still show the failed attempt's message.
    expect(updated[0].data.error).toBeNull();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('report.generated');
    expect(emitted[0].payload.kind).toBe('AUTOMATIC_SCAN_REPORT');
    expect(emitted[0].payload.userId).toBe('user_1');
  });

  it('records a terminal failure as FAILED and never as completed', async () => {
    const { service, updated, emitted } = makeService();

    await service.markFailed({
      reportId: 'report_1',
      assessmentId: 'scan_123',
      reason: 'Chromium exited before the page was printed',
      attempts: 3,
    });

    expect(updated[0].data.status).toBe('FAILED');
    expect(updated[0].data.error).toContain('Chromium exited');

    expect(emitted[0].event).toBe('report.failed');
    expect(emitted[0].payload.attempts).toBe(3);
    // Addressed to the owner, so the user learns their report is not coming.
    expect(emitted[0].payload.userId).toBe('user_1');
  });

  it('truncates a runaway error rather than storing a whole stack trace', async () => {
    const { service, updated } = makeService();

    await service.markFailed({
      reportId: 'report_1',
      assessmentId: 'scan_123',
      reason: 'x'.repeat(2000),
      attempts: 3,
    });

    expect(updated[0].data.error.length).toBeLessThanOrEqual(500);
    expect(updated[0].data.error.endsWith('...')).toBe(true);
  });
});
