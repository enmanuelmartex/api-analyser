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

/**
 * When the fixture's scan finished, as an instant.
 *
 * 02:30 UTC on the 14th, which is 22:30 on the 13th in `America/Santo_Domingo`.
 * The two dates differing is the point: a processor that formatted the
 * timestamp in UTC instead of in the recipient's zone would report the wrong
 * day, and this instant is what makes that visible rather than coincidentally
 * correct.
 */
const COMPLETED_AT = new Date('2026-08-14T02:30:00Z');

interface Options {
  preferences?: Record<string, boolean>;
  user?: any;
  /** Overrides on the assessment summary — risk level, endpoint count, … */
  summary?: Record<string, unknown>;
  /** What `WeeklySummaryService.compute` returns. `null` means "no projects". */
  weeklySummary?: any;
  reportStatus?: string;
  fileSize?: number;
  maxAttachmentBytes?: number;
  artifactThrows?: boolean;
  alreadySent?: boolean;
  /** `notifications.reportRecipients` — the install-wide address list. */
  configuredRecipients?: string[];
  /** The install-level switches those addresses are subject to. */
  emailOnScanCompleted?: boolean;
  emailOnScanFailed?: boolean;
  appUrl?: string;
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
          ...options.summary,
        },
        // Late enough in the UTC day that anywhere west of Greenwich is still
        // on the previous date — which is what makes the timezone test below
        // able to fail.
        completedAt: COMPLETED_AT,
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
    wantsWeeklySummary: async () =>
      preferences.emailEnabled && (preferences.emailWeeklySummary ?? true),
  };

  const weekly = {
    // `in` rather than `??`, because null is a meaningful value here — "this
    // user has no projects" — and `??` would fall through to the default.
    compute: async () =>
      'weeklySummary' in options ? options.weeklySummary : DEFAULT_WEEKLY_SUMMARY,
    dashboardUrl: () =>
      options.appUrl === '' ? undefined : `${options.appUrl ?? 'https://scan.example.com'}/dashboard`,
  };

  const email = {
    send: async (input: any) => {
      sent.push(input);
      return { status: 'SENT', deliveryId: 'd1' };
    },
    alreadySent: async () => options.alreadySent ?? false,
  };

  const settings = {
    getList: async (key: string) =>
      key === 'notifications.reportRecipients' ? (options.configuredRecipients ?? []) : [],
    getBoolean: async (key: string) =>
      ({
        'notifications.emailOnScanCompleted': options.emailOnScanCompleted ?? true,
        'notifications.emailOnScanFailed': options.emailOnScanFailed ?? true,
      })[key] ?? true,
  };

  const config = {
    get: (key: string) =>
      ({
        'email.appUrl': options.appUrl ?? 'https://scan.example.com',
        'email.maxAttachmentBytes': options.maxAttachmentBytes ?? 8 * 1024 * 1024,
      })[key],
  };

  const processor = new EmailProcessor(
    prisma as any,
    reports as any,
    preferencesService as any,
    settings as any,
    email as any,
    config as any,
    weekly as any,
  );

  return { processor, sent, resolveCalls };
}

/** A representative week, for the digest tests. */
const DEFAULT_WEEKLY_SUMMARY = {
  week: {
    start: new Date('2026-09-07T04:00:00Z'),
    endExclusive: new Date('2026-09-14T04:00:00Z'),
    fromDate: '2026-09-07',
    toDate: '2026-09-13',
  },
  assessments: { count: 14, changePercent: 12 },
  findings: { count: 23, changePercent: -8 },
  critical: { count: 3, changePercent: 0 },
  activeProjects: 3,
  isEmpty: false,
};

const WEEKLY_JOB = {
  data: { type: 'weekly-summary', userId: 'user_1', weekStart: '2026-09-07' },
} as any;

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

  it('keys the delivery on the report and the address', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(READY_JOB);

    // Stable across retries of the same logical send, distinct for a different
    // report or a different recipient. Keyed on the address rather than a user
    // id because most recipients are configured mailboxes with no user at all.
    expect(sent[0].idempotencyKey).toBe('report-ready:report_456:owner@example.com');
  });

  it('sends nothing when the owner has email off and nothing is configured', async () => {
    const { processor, sent } = makeProcessor({ preferences: { emailEnabled: false } });

    const result = await processor.process(READY_JOB);

    expect(sent).toHaveLength(0);
    expect(result).toEqual({ skipped: 'no-recipients' });
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

    expect(result).toMatchObject({ skipped: 'already-sent' });
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
    expect(sent[0].idempotencyKey).toBe('critical-finding:scan_123:owner@example.com');
  });

  it('does not also send the critical email when the completion email goes out', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('report-ready');
  });
});

/**
 * The configured recipient list.
 *
 * An installation-wide setting, and the reason this pipeline exists at all: the
 * addresses a security report should reach are usually a team mailbox and a
 * ticketing inbox, not the account of whoever happens to own the project.
 */
describe('configured recipients', () => {
  it('sends to every configured address as well as the owner', async () => {
    const { processor, sent, resolveCalls } = makeProcessor({
      configuredRecipients: ['security@corp.example', 'tickets@corp.example'],
    });

    await processor.process(READY_JOB);

    expect(sent.map((message) => message.to)).toEqual([
      'security@corp.example',
      'tickets@corp.example',
      'owner@example.com',
    ]);

    // The PDF is read once and shared, not re-read per recipient.
    expect(resolveCalls).toEqual(['report_456']);
    for (const message of sent) {
      expect(message.attachments).toHaveLength(1);
    }
  });

  it('gives each address its own idempotency key', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(READY_JOB);

    // Distinct, so a partial failure retries only the addresses that missed it.
    expect(sent.map((message) => message.idempotencyKey)).toEqual([
      'report-ready:report_456:security@corp.example',
      'report-ready:report_456:owner@example.com',
    ]);
  });

  it('sends to configured addresses even when the owner wants no email', async () => {
    const { processor, sent } = makeProcessor({
      preferences: { emailEnabled: false },
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(READY_JOB);

    // The two audiences are independent: an administrator's recipient list is
    // not overridden by one user's preferences.
    expect(sent.map((message) => message.to)).toEqual(['security@corp.example']);
  });

  it('sends to configured addresses even when the owner is deactivated', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'u', email: 'gone@example.com', isActive: false },
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(READY_JOB);

    expect(sent.map((message) => message.to)).toEqual(['security@corp.example']);
  });

  it('does not send the same report twice to an owner who is also on the list', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example', 'OWNER@example.com'],
    });

    await processor.process(READY_JOB);

    expect(sent).toHaveLength(2);
    // The surviving copy is attributed to the user account, which is the more
    // useful delivery row of the two.
    const ownerMessage = sent.find((message) => message.to.toLowerCase() === 'owner@example.com');
    expect(ownerMessage.userId).toBe('user_1');
  });

  it('leaves a configured address with no user id on its delivery row', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(READY_JOB);

    expect(sent[0].userId).toBeUndefined();
  });

  it('stops mailing the list when the install switch is off', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
      emailOnScanCompleted: false,
    });

    await processor.process(READY_JOB);

    // The owner still gets theirs — the switch governs the configured list.
    expect(sent.map((message) => message.to)).toEqual(['owner@example.com']);
  });

  it('carries a relay payload the hosted relay can render', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(READY_JOB);

    // Without this the message cannot travel through the relay at all — it
    // renders its own templates and refuses HTML.
    expect(sent[0].relay).toEqual({
      template: 'scan-report',
      data: {
        projectName: 'Production API',
        securityScore: 74,
        counts: { critical: 1, high: 3, medium: 5, low: 2, info: 0 },
        totalFindings: 11,
        reportUrl: 'https://scan.example.com/reports/report_456',
        /*
         * The fields the redesigned template added, absent in this fixture
         * because its summary carries no risk level or endpoint count and its
         * recipient is a configured mailbox with no name.
         *
         * Asserted as explicit `undefined` rather than omitted from the
         * expectation: `toEqual` would accept either, and writing them out is
         * what proves the payload degrades to "field not sent" rather than to
         * a string reading "undefined". `JSON.stringify` drops these keys, so
         * the relay receives an object without them and its `.optional()`
         * schema accepts it.
         */
        userName: undefined,
        riskLevel: undefined,
        endpointsEvaluated: undefined,
        // A calendar date, never a timestamp. The relay's schema rejects
        // anything carrying a time or an offset — see the note in its
        // `format.ts` on why a timezone never crosses that boundary. The exact
        // value depends on the runner's zone; the zone-specific behaviour is
        // pinned by the test below instead.
        scanDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    });
  });

  /*
   * The UTC off-by-one, as a test.
   *
   * The scan finished at 02:30 UTC on the 14th, which is 22:30 on the 13th for
   * a user in Santo Domingo. They ran it on the 13th and the email has to say
   * so. Formatting the instant in UTC — the obvious implementation — produces
   * "August 14" and is wrong for every user west of Greenwich, in the evening,
   * which is to say in production and never in a test written in UTC.
   */
  it('resolves the scan date in the recipient own timezone, not UTC', async () => {
    const { processor, sent } = makeProcessor({
      user: {
        id: 'user_1',
        email: 'owner@example.com',
        isActive: true,
        name: 'Ada',
        timeZone: 'America/Santo_Domingo',
        theme: 'dark',
      },
    });

    await processor.process(READY_JOB);

    expect(sent[0].relay.data.scanDate).toBe('2026-08-13');
    expect(sent[0].relay.data.userName).toBe('Ada');
    // The stored preference decides the variant; the relay never guesses.
    expect(sent[0].theme).toBe('dark');
  });

  it('greets a configured mailbox neutrally and renders it light', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
      // No owner at all, so the only recipient is the configured address.
      user: null,
    });

    await processor.process(READY_JOB);

    // There is no person behind a team mailbox to have a name or a preference,
    // so the message carries neither rather than borrowing someone else's.
    expect(sent[0].relay.data.userName).toBeUndefined();
    expect(sent[0].theme).toBe('light');
  });

  it('passes the risk level and endpoint count through when the summary has them', async () => {
    const { processor, sent } = makeProcessor({
      summary: { riskLevel: 'HIGH', testedEndpoints: 12 },
    });

    await processor.process(READY_JOB);

    expect(sent[0].relay.data.riskLevel).toBe('HIGH');
    expect(sent[0].relay.data.endpointsEvaluated).toBe(12);
  });

  /*
   * `riskLevel` is a plain string column with a "LOW" default rather than a
   * database enum, so an old row or a future scorer could hold anything. An
   * unrecognised value must become an omitted field, not a 400 from the relay
   * that loses the whole email over a cosmetic row.
   */
  it('drops a risk level the relay would reject rather than losing the email', async () => {
    const { processor, sent } = makeProcessor({
      summary: { riskLevel: 'CATASTROPHIC' },
    });

    await processor.process(READY_JOB);

    expect(sent[0].relay.data.riskLevel).toBeUndefined();
  });

  it('accepts a lower-case risk level from an older row', async () => {
    const { processor, sent } = makeProcessor({ summary: { riskLevel: 'high' } });

    await processor.process(READY_JOB);

    expect(sent[0].relay.data.riskLevel).toBe('HIGH');
  });

  it('omits the link entirely when the install has no app URL', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
      appUrl: '',
    });

    await processor.process(READY_JOB);

    // The relay rejects a relative URL, and a button pointing at "" helps
    // nobody. Both halves simply omit it.
    expect(sent[0].relay.data.reportUrl).toBeUndefined();
    expect(sent[0].html).not.toContain('View Report');
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

  it('tells the configured addresses too', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
    });

    await processor.process(FAILED_JOB);

    // A failed scheduled scan is easy to miss otherwise.
    expect(sent.map((message) => message.to)).toEqual([
      'security@corp.example',
      'owner@example.com',
    ]);
    expect(sent[0].relay.template).toBe('scan-failed');
  });

  it('honours its own install switch, separate from the completed one', async () => {
    const { processor, sent } = makeProcessor({
      configuredRecipients: ['security@corp.example'],
      preferences: { emailScanFailed: false },
      emailOnScanFailed: false,
    });

    await processor.process(FAILED_JOB);

    expect(sent).toHaveLength(0);
  });
});

/**
 * The weekly digest, from queued job to a message handed to `EmailService`.
 *
 * The job carries only a user id and a week; every figure and every gate is
 * resolved here, at send time. That is what makes a job which sat in the queue
 * through a restart report the week as it actually was.
 */
describe('weekly summary', () => {
  it('sends a digest built from the computed metrics', async () => {
    const { processor, sent } = makeProcessor({
      user: {
        id: 'user_1',
        email: 'ada@example.com',
        name: 'Ada',
        isActive: true,
        theme: 'dark',
      },
    });

    await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ada@example.com');
    expect(sent[0].template).toBe('weekly-summary');
    expect(sent[0].theme).toBe('dark');
    expect(sent[0].relay).toEqual({
      template: 'weekly-summary',
      data: {
        userName: 'Ada',
        dateFrom: '2026-09-07',
        dateTo: '2026-09-13',
        assessments: { count: 14, changePercent: 12 },
        findings: { count: 23, changePercent: -8 },
        critical: { count: 3, changePercent: 0 },
        activeProjects: 3,
        dashboardUrl: 'https://scan.example.com/dashboard',
      },
    });
  });

  /*
   * Layer 3 of the duplicate guard, from the caller's side.
   *
   * The key is derived from the WEEK, not from the send date, so a job retried
   * days later produces the same key — and `EmailService` claims it on a unique
   * index before the transport is called.
   */
  it('keys idempotency on the week, so a retry cannot send a second copy', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'user_1', email: 'Ada@Example.com', name: 'Ada', isActive: true },
    });

    await processor.process(WEEKLY_JOB);

    // Lower-cased, so two spellings of one address cannot both be delivered.
    expect(sent[0].idempotencyKey).toBe('weekly-summary:2026-09-07:ada@example.com');
  });

  it('does not send when the digest was already delivered for that week', async () => {
    const { processor, sent } = makeProcessor({ alreadySent: true });

    const result: any = await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe('already-sent');
  });

  /*
   * Re-checked here rather than trusted from the scheduler: a job can wait in
   * the queue, and a user who switched email off in the meantime must not
   * receive one.
   */
  it('re-checks the preference at send time, not at queue time', async () => {
    const { processor, sent } = makeProcessor({
      preferences: { emailEnabled: false },
    });

    const result: any = await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe('preference-off');
  });

  it('does not send to a deactivated account', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'user_1', email: 'ada@example.com', isActive: false },
    });

    const result: any = await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe('user-unavailable');
  });

  it('does not send to an account with no address', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'user_1', email: null, isActive: true },
    });

    await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
  });

  it('sends nothing for a user with no projects', async () => {
    const { processor, sent } = makeProcessor({ weeklySummary: null });

    const result: any = await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe('no-projects');
  });

  /*
   * Four zeroes every Monday is how a useful digest becomes something people
   * filter. The check is narrow on purpose — see the note on `isEmpty`.
   */
  it('declines to send a digest describing nothing at all', async () => {
    const { processor, sent } = makeProcessor({
      weeklySummary: { ...DEFAULT_WEEKLY_SUMMARY, isEmpty: true },
    });

    const result: any = await processor.process(WEEKLY_JOB);

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe('no-activity');
  });

  it('renders light for a user who has never chosen a theme', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'user_1', email: 'ada@example.com', name: 'Ada', isActive: true, theme: null },
    });

    await processor.process(WEEKLY_JOB);

    expect(sent[0].theme).toBe('light');
  });

  /*
   * `system` cannot be honoured server-side — there is no OS to consult — so it
   * must collapse to a concrete value. The relay rejects the word outright, so
   * sending it through would lose the email.
   */
  it('resolves the "system" theme to a concrete variant', async () => {
    const { processor, sent } = makeProcessor({
      user: { id: 'user_1', email: 'ada@example.com', name: 'Ada', isActive: true, theme: 'system' },
    });

    await processor.process(WEEKLY_JOB);

    expect(sent[0].theme).toBe('light');
  });

  it('omits the dashboard link when the install has no app URL', async () => {
    const { processor, sent } = makeProcessor({ appUrl: '' });

    await processor.process(WEEKLY_JOB);

    expect(sent[0].relay.data.dashboardUrl).toBeUndefined();
  });

  it('carries a plain-text alternative and never leaks a placeholder', async () => {
    const { processor, sent } = makeProcessor();

    await processor.process(WEEKLY_JOB);

    expect(sent[0].text.length).toBeGreaterThan(80);
    expect(sent[0].text).not.toContain('undefined');
    expect(sent[0].html).not.toContain('undefined');
    expect(sent[0].html).not.toContain('NaN');
    expect(sent[0].html).not.toContain('Infinity');
  });

  it('renders no percentage when a week has no baseline', async () => {
    const { processor, sent } = makeProcessor({
      weeklySummary: {
        ...DEFAULT_WEEKLY_SUMMARY,
        assessments: { count: 7, changePercent: null },
        findings: { count: 0, changePercent: null },
        critical: { count: 0, changePercent: null },
      },
    });

    await processor.process(WEEKLY_JOB);

    expect(sent[0].html).not.toContain('Infinity');
    expect(sent[0].html).not.toContain('NaN');
    expect(sent[0].text).toContain('no comparison available');
  });
});
