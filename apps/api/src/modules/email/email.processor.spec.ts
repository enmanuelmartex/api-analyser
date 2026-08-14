import { describe, expect, it } from 'bun:test';
import { EmailProcessor } from './email.processor';

/**
 * What decides whether a report email is sent, and what it carries.
 *
 * Three rules under test, all of them things the product promises:
 *   • the email respects the recipient's preferences, read at send time;
 *   • it attaches the PDF that was already generated, never a fresh render;
 *   • it never announces a report that is not COMPLETED.
 */

interface Options {
  preferences?: Record<string, boolean>;
  user?: any;
  reportStatus?: string;
  fileSize?: number;
  maxAttachmentBytes?: number;
  artifactThrows?: boolean;
  alreadySent?: boolean;
}

function makeProcessor(options: Options = {}) {
  const sent: any[] = [];
  const resolveCalls: string[] = [];

  const preferences = {
    emailEnabled: true,
    emailScanCompleted: true,
    emailReportGenerated: true,
    emailScanFailed: true,
    emailCriticalFinding: true,
    ...options.preferences,
  };

  const prisma = {
    user: {
      findUnique: async () =>
        options.user === undefined
          ? { id: 'user_1', email: 'owner@example.com', isActive: true }
          : options.user,
    },
    assessment: {
      findUnique: async () => ({
        id: 'scan_123',
        summary: {
          securityScore: 74,
          totalFindings: 11,
          criticalCount: 1,
          highCount: 3,
          mediumCount: 5,
          lowCount: 2,
          infoCount: 0,
        },
        project: { id: 'proj_1', name: 'Production API' },
      }),
    },
    report: {
      findUnique: async () => ({
        status: options.reportStatus ?? 'COMPLETED',
        fileSize: options.fileSize ?? 51_200,
      }),
    },
  };

  const reports = {
    resolveArtifact: async (reportId: string) => {
      resolveCalls.push(reportId);
      if (options.artifactThrows) throw new Error('storage unavailable');
      return {
        bytes: Buffer.from('%PDF-1.7 stored bytes'),
        fileName: 'security-report-production-api.pdf',
        contentType: 'application/pdf',
        rehydrated: false,
      };
    },
  };

  const preferencesService = {
    wantsEmail: async (_userId: string, type: string) => {
      const map: Record<string, boolean> = {
        SCAN_COMPLETED: preferences.emailEnabled && preferences.emailScanCompleted,
        REPORT_GENERATED: preferences.emailEnabled && preferences.emailReportGenerated,
        SCAN_FAILED: preferences.emailEnabled && preferences.emailScanFailed,
        CRITICAL_FINDING: preferences.emailEnabled && preferences.emailCriticalFinding,
      };
      return map[type] ?? false;
    },
  };

  const email = {
    send: async (input: any) => {
      sent.push(input);
      return { status: 'SENT', deliveryId: 'd1' };
    },
    alreadySent: async () => options.alreadySent ?? false,
  };

  const config = {
    get: (key: string) =>
      ({
        'email.appUrl': 'https://scan.example.com',
        'email.maxAttachmentBytes': options.maxAttachmentBytes ?? 8 * 1024 * 1024,
      })[key],
  };

  const processor = new EmailProcessor(
    prisma as any,
    reports as any,
    preferencesService as any,
    email as any,
    config as any,
  );

  return { processor, sent, resolveCalls };
}

const READY_JOB = {
  data: { type: 'scan-report-ready', reportId: 'report_456', assessmentId: 'scan_123', userId: 'user_1' },
} as any;

describe('report-ready email', () => {
  it('sends the summary with the stored PDF attached', async () => {
    const { processor, sent, resolveCalls } = makeProcessor();

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('report-ready');
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toBe('Scan complete — Production API');

    // The attachment is the artifact already on disk. `resolveArtifact` reads
    // stored bytes; nothing here re-renders a PDF for the email.
    expect(resolveCalls).toEqual(['report_456']);
    expect(sent[0].attachments).toHaveLength(1);
    expect(sent[0].attachments[0].filename).toBe('security-report-production-api.pdf');

    // The body carries the score and the breakdown.
    expect(sent[0].html).toContain('74/100');
    expect(sent[0].text).toContain('Critical: 1');
    expect(sent[0].html).toContain('https://scan.example.com/reports/report_456');
  });

  it('keys the delivery on the report and the recipient', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(READY_JOB);

    // Stable across retries of the same logical send, distinct for a different
    // report or a different user.
    expect(sent[0].idempotencyKey).toBe('report-ready:report_456:user_1');
  });

  it('sends nothing when the user has email switched off', async () => {
    const { processor, sent } = makeProcessor({ preferences: { emailEnabled: false } });

    const result = await processor.process(READY_JOB);

    expect(sent).toHaveLength(0);
    expect(result).toEqual({ skipped: 'preferences' });
  });

  it('sends nothing to a deactivated user', async () => {
    const { processor, sent } = makeProcessor({ user: { id: 'u', email: 'x@y.z', isActive: false } });

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(0);
  });

  /**
   * On a retry of an already-sent message, the several-megabyte PDF must not be
   * read off disk only to be thrown away.
   */
  it('does not load the attachment for a message already sent', async () => {
    const { processor, sent, resolveCalls } = makeProcessor({ alreadySent: true });

    const result = await processor.process(READY_JOB);

    expect(result).toEqual({ skipped: 'already-sent' });
    expect(resolveCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('links instead of attaching when the PDF is over the size limit', async () => {
    const { processor, sent, resolveCalls } = makeProcessor({
      fileSize: 20 * 1024 * 1024,
      maxAttachmentBytes: 8 * 1024 * 1024,
    });

    await processor.process(READY_JOB);

    expect(resolveCalls).toHaveLength(0);
    expect(sent[0].attachments).toBeUndefined();
    // The body says why, rather than silently omitting a promised file.
    expect(sent[0].html).toContain('8MB attachment limit');
  });

  it('still sends, without the attachment, when the artifact cannot be read', async () => {
    const { processor, sent } = makeProcessor({ artifactThrows: true });

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].html).toContain('View Report');
  });

  /**
   * The ordering guarantee, defended a second time.
   *
   * The job is only queued by `report.generated`, which fires after COMPLETED.
   * This is the backstop: if that ever stops holding, the email refuses to
   * attach rather than mailing a half-written file.
   */
  it('refuses to attach a report that is not COMPLETED', async () => {
    const { processor, sent, resolveCalls } = makeProcessor({ reportStatus: 'GENERATING' });

    await processor.process(READY_JOB);

    expect(resolveCalls).toHaveLength(0);
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].html).toContain('still generating');
  });

  /**
   * One email, not two.
   *
   * With scan-completed muted but criticals wanted, the critical template is the
   * only one that fires — otherwise the breakdown would never reach the user.
   */
  it('sends the critical-only email when routine completions are muted', async () => {
    const { processor, sent } = makeProcessor({
      preferences: {
        emailScanCompleted: false,
        emailReportGenerated: false,
        emailCriticalFinding: true,
      },
    });

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('critical-finding');
    expect(sent[0].idempotencyKey).toBe('critical-finding:scan_123:user_1');
  });

  it('does not also send the critical email when the completion email goes out', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('report-ready');
  });
});

describe('scan-failed email', () => {
  const FAILED_JOB = {
    data: {
      type: 'scan-failed',
      assessmentId: 'scan_123',
      userId: 'user_1',
      reason: 'Target unreachable',
    },
  } as any;

  it('sends the failure with its reason', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(FAILED_JOB);

    expect(sent[0].template).toBe('scan-failed');
    expect(sent[0].subject).toBe('Scan failed — Production API');
    expect(sent[0].html).toContain('Target unreachable');
    // No report exists for a failed run, and the email says so.
    expect(sent[0].html).toContain('No report was generated');
    expect(sent[0].attachments).toBeUndefined();
  });

  it('respects the scan-failed preference', async () => {
    const { processor, sent } = makeProcessor({ preferences: { emailScanFailed: false } });

    await processor.process(FAILED_JOB);

    expect(sent).toHaveLength(0);
  });
});
