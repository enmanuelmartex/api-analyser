import { describe, expect, it } from 'bun:test';
import { EmailListener } from './email.listener';

/**
 * What reaches the queue, and under what job id.
 *
 * The job id is the interesting part, and it is why this file exists. BullMQ
 * uses `:` to separate the segments of its own Redis keys and rejects a custom
 * id containing one — "Custom Id cannot contain :" — by throwing at `add`.
 *
 * That failure is quiet in exactly the wrong way. `enqueue` swallows it so a
 * mail problem cannot fail the scan that produced it, so a colon here does not
 * look like a broken queue: it looks like a scan that completed, a report row
 * that exists, and an email that simply never arrives. It cost a debugging
 * session once; these tests are cheaper than the second one.
 */

function makeListener(options: { addThrows?: Error } = {}) {
  const added: { name: string; job: any; opts: any }[] = [];

  const queue = {
    add: async (name: string, job: any, opts: any) => {
      if (options.addThrows) throw options.addThrows;
      added.push({ name, job, opts });
      return { id: opts?.jobId };
    },
  };

  return { listener: new EmailListener(queue as any), added };
}

const REPORT_EVENT = {
  reportId: 'report_1',
  assessmentId: 'scan_1',
  userId: 'user_1',
  kind: 'AUTOMATIC_SCAN_REPORT',
  reportType: 'TECHNICAL',
  format: 'PDF',
};

const FAILED_EVENT = {
  assessmentId: 'scan_1',
  projectId: 'proj_1',
  projectName: 'Production API',
  userId: 'user_1',
  reason: 'Target unreachable',
};

describe('job ids', () => {
  /**
   * The regression guard. Asserted on every id this listener produces rather
   * than on one example, so a new job type added later is covered by default.
   */
  it('never contains a colon, which BullMQ rejects outright', async () => {
    const { listener, added } = makeListener();

    await listener.onReportGenerated(REPORT_EVENT as any);
    await listener.onScanFailed(FAILED_EVENT as any);

    expect(added).toHaveLength(2);
    for (const { opts } of added) {
      expect(opts.jobId).toBeString();
      expect(opts.jobId).not.toContain(':');
    }
  });

  it('is deterministic, so a redelivered event does not queue twice', async () => {
    const { listener, added } = makeListener();

    await listener.onReportGenerated(REPORT_EVENT as any);
    await listener.onReportGenerated(REPORT_EVENT as any);

    // BullMQ discards the second add for an id already in the queue; the
    // durable guarantee is still the unique idempotencyKey on the delivery row.
    expect(added[0].opts.jobId).toBe(added[1].opts.jobId);
    expect(added[0].opts.jobId).toBe('report-ready-report_1');
  });

  it('distinguishes different reports and different assessments', async () => {
    const { listener, added } = makeListener();

    await listener.onReportGenerated(REPORT_EVENT as any);
    await listener.onReportGenerated({ ...REPORT_EVENT, reportId: 'report_2' } as any);
    await listener.onScanFailed(FAILED_EVENT as any);

    const ids = added.map((entry) => entry.opts.jobId);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('what is queued', () => {
  it('queues the report email for an automatic report', async () => {
    const { listener, added } = makeListener();

    await listener.onReportGenerated(REPORT_EVENT as any);

    expect(added[0].job).toEqual({
      type: 'scan-report-ready',
      reportId: 'report_1',
      assessmentId: 'scan_1',
      userId: 'user_1',
    });
  });

  it('ignores a manually exported report', async () => {
    const { listener, added } = makeListener();

    // A hand-requested export is something the user is already looking at;
    // mailing it would be a surprise.
    await listener.onReportGenerated({ ...REPORT_EVENT, kind: 'MANUAL_EXPORT' } as any);

    expect(added).toHaveLength(0);
  });

  it('queues even when the project has no active owner', async () => {
    const { listener, added } = makeListener();

    // The addresses configured for the installation do not depend on a user
    // existing. Who actually receives it is the processor's decision.
    await listener.onReportGenerated({ ...REPORT_EVENT, userId: undefined } as any);

    expect(added).toHaveLength(1);
    expect(added[0].job.userId).toBeUndefined();
  });
});

describe('failure handling', () => {
  it('never propagates a queue failure', async () => {
    // This runs on the tick of the worker that generated the report. An
    // unreachable Redis must not turn a successful report into a failed job.
    const { listener } = makeListener({ addThrows: new Error('Redis is down') });

    await listener.onReportGenerated(REPORT_EVENT as any);
    await listener.onScanFailed(FAILED_EVENT as any);
  });
});
