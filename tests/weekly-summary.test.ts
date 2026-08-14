import { describe, expect, test } from 'bun:test';
import { handleSend } from '@/lib/relay/send-handler';
import { RelayError } from '@/lib/http/errors';
import { parseSendRequest } from '@/lib/validation/send.schema';
import { FakeMailer, readJson, TEST_SECRET, testDependencies } from './helpers';

function sendRequest(body: unknown, token: string | null = TEST_SECRET): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  return new Request('https://mail.apianalyser.com/api/send', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const weekly = {
  to: 'ada@example.com',
  template: 'weekly-summary',
  theme: 'dark',
  data: {
    userName: 'Ada',
    dateFrom: '2026-08-07',
    dateTo: '2026-08-13',
    assessments: { count: 14, changePercent: 12 },
    findings: { count: 23, changePercent: -8 },
    critical: { count: 3, changePercent: 0 },
    activeProjects: 3,
    dashboardUrl: 'https://app.example.com/dashboard',
  },
};

/** Strips a key from the payload's `data`, for the "field is required" cases. */
const withoutData = (key: string) => {
  const data = { ...weekly.data } as Record<string, unknown>;
  delete data[key];
  return { ...weekly, data };
};

describe('POST /api/send — weekly-summary', () => {
  test('sends a message this server built entirely', async () => {
    const mailer = new FakeMailer();
    const response = await handleSend(sendRequest(weekly), testDependencies({ mailer }));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ success: true });

    const sent = mailer.lastSent!;
    expect(sent.to).toBe('ada@example.com');
    expect(sent.subject).toBe('Your weekly summary — API Analyzer');
    expect(sent.html).toContain('Weekly Summary');
    expect(sent.html).toContain('Hi Ada,');
    expect(sent.html).toContain('August 7 – 13, 2026');
    expect(sent.html).toContain('14');
    expect(sent.html).toContain('+12%');
    expect(sent.html).toContain('-8%');
    expect(sent.text.length).toBeGreaterThan(80);
    // A summary has nothing to attach, and the schema refuses one.
    expect(sent.attachments).toEqual([]);
  });

  test('honours the requested theme', async () => {
    const dark = new FakeMailer();
    await handleSend(sendRequest(weekly), testDependencies({ mailer: dark }));
    expect(dark.lastSent!.html).toContain('content="dark"');
    expect(dark.lastSent!.html).toContain('mark-dark.png');

    const light = new FakeMailer();
    await handleSend(
      sendRequest({ ...weekly, theme: 'light' }),
      testDependencies({ mailer: light }),
    );
    expect(light.lastSent!.html).toContain('content="light"');
    expect(light.lastSent!.html).toContain('mark-light.png');
  });

  test('defaults to light when no theme is named', async () => {
    const mailer = new FakeMailer();
    const { theme: _dropped, ...noTheme } = weekly;
    await handleSend(sendRequest(noTheme), testDependencies({ mailer }));
    expect(mailer.lastSent!.html).toContain('content="light"');
  });

  test('a null changePercent produces no percentage rather than Infinity', async () => {
    const mailer = new FakeMailer();
    await handleSend(
      sendRequest({
        ...weekly,
        data: {
          ...weekly.data,
          assessments: { count: 5, changePercent: null },
          findings: { count: 0, changePercent: null },
          critical: { count: 0, changePercent: null },
        },
      }),
      testDependencies({ mailer }),
    );

    const { html, text } = mailer.lastSent!;
    for (const body of [html, text]) {
      expect(body).not.toContain('Infinity');
      expect(body).not.toContain('NaN');
    }
    expect(html).not.toMatch(/>[+-]?\d+%</);
  });

  test('the logo origin comes from configuration, not from the request', async () => {
    const mailer = new FakeMailer();
    await handleSend(
      sendRequest({
        ...weekly,
        // Ignored — there is no such field, so `.strict()` rejects it outright.
        assetBaseUrl: 'https://attacker.example',
      }),
      testDependencies({ mailer }),
    );
    expect(mailer.sent).toBeEmpty();
  });
});

describe('weekly-summary — payload validation', () => {
  const rejected: { name: string; body: unknown }[] = [
    { name: 'a missing dateFrom', body: withoutData('dateFrom') },
    { name: 'a missing dateTo', body: withoutData('dateTo') },
    { name: 'a missing assessments block', body: withoutData('assessments') },
    { name: 'a missing activeProjects', body: withoutData('activeProjects') },
    {
      name: 'a timestamp where a calendar date belongs',
      body: { ...weekly, data: { ...weekly.data, dateFrom: '2026-08-07T00:00:00Z' } },
    },
    {
      name: 'a date that does not exist',
      body: { ...weekly, data: { ...weekly.data, dateFrom: '2026-02-30' } },
    },
    {
      name: 'a month that does not exist',
      body: { ...weekly, data: { ...weekly.data, dateFrom: '2026-13-01' } },
    },
    {
      name: 'a range that runs backwards',
      body: { ...weekly, data: { ...weekly.data, dateFrom: '2026-08-13', dateTo: '2026-08-07' } },
    },
    {
      name: 'a negative count',
      body: { ...weekly, data: { ...weekly.data, activeProjects: -1 } },
    },
    {
      name: 'a fractional count',
      body: {
        ...weekly,
        data: { ...weekly.data, assessments: { count: 1.5, changePercent: 0 } },
      },
    },
    {
      name: 'a changePercent that is absent rather than explicitly null',
      body: { ...weekly, data: { ...weekly.data, assessments: { count: 4 } } },
    },
    /*
     * Not `Infinity` itself — JSON has no way to carry it, and
     * `JSON.stringify` turns it into `null`, which is a legal "no comparison".
     * The realistic bad value is a percentage produced by dividing by a very
     * small previous week, and the ceiling is what stops it.
     */
    {
      name: 'a changePercent beyond the sane ceiling',
      body: {
        ...weekly,
        data: { ...weekly.data, assessments: { count: 4, changePercent: 1_000_000 } },
      },
    },
    {
      name: 'a changePercent below -100%',
      body: {
        ...weekly,
        data: { ...weekly.data, findings: { count: 0, changePercent: -150 } },
      },
    },
    {
      name: 'an unknown field inside a metric',
      body: {
        ...weekly,
        data: { ...weekly.data, critical: { count: 1, changePercent: 0, trend: 'up' } },
      },
    },
    {
      name: 'an unknown top-level data field',
      body: { ...weekly, data: { ...weekly.data, extra: 'nope' } },
    },
    { name: 'an invalid theme', body: { ...weekly, theme: 'midnight' } },
    /*
     * `system` is specifically rejected. "Follow the OS" is a question only a
     * browser can answer, and there is no browser here — the API must resolve
     * it against the user's stored preference before calling.
     */
    { name: 'the unresolved "system" theme', body: { ...weekly, theme: 'system' } },
    {
      name: 'a javascript: dashboard URL',
      body: { ...weekly, data: { ...weekly.data, dashboardUrl: 'javascript:alert(1)' } },
    },
    {
      name: 'a data: dashboard URL',
      body: {
        ...weekly,
        data: { ...weekly.data, dashboardUrl: 'data:text/html,<script>alert(1)</script>' },
      },
    },
    { name: 'an invalid recipient', body: { ...weekly, to: 'not-an-email' } },
    { name: 'caller-supplied html', body: { ...weekly, html: '<h1>phish</h1>' } },
    { name: 'a caller-supplied subject', body: { ...weekly, subject: 'Anything I like' } },
    { name: 'a caller-supplied sender', body: { ...weekly, from: 'ceo@bank.example' } },
    { name: 'a caller-supplied bcc', body: { ...weekly, bcc: 'victim@example.com' } },
    { name: 'caller-supplied headers', body: { ...weekly, headers: { 'X-Evil': '1' } } },
    {
      name: 'an attachment on a template that has nothing to attach',
      body: { ...weekly, attachment: { filename: 'x.pdf', contentBase64: 'AAAA' } },
    },
    {
      name: 'a line break in the user name',
      body: { ...weekly, data: { ...weekly.data, userName: 'Ada\r\nBcc: victim@example.com' } },
    },
  ];

  test.each(rejected)('rejects $name with 400 and sends nothing', async ({ body }) => {
    const mailer = new FakeMailer();
    const response = await handleSend(sendRequest(body), testDependencies({ mailer }));

    expect(response.status).toBe(400);
    expect(mailer.sent).toBeEmpty();
  });

  test('an unknown field is named as unsupported rather than ignored', () => {
    /*
     * The public message is what the caller sees; `Error.message` carries the
     * log detail, which names the failing path and the Zod code and is not for
     * them. Asserting both is what pins the split — a regression that leaked
     * internals into the response would pass a check on `message` alone.
     */
    try {
      parseSendRequest({ ...weekly, html: '<h1>x</h1>' });
      throw new Error('expected parseSendRequest to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(RelayError);
      const relayError = error as RelayError;
      expect(relayError.status).toBe(400);
      expect(relayError.publicMessage).toMatch(/unsupported fields/i);
      expect(relayError.publicMessage).not.toContain('unrecognized_keys');
    }
  });

  test('a bad template name lists the ones that exist', () => {
    try {
      parseSendRequest({ ...weekly, template: 'send-anything' });
      throw new Error('expected parseSendRequest to reject');
    } catch (error) {
      expect((error as RelayError).publicMessage).toContain('weekly-summary');
      expect((error as RelayError).publicMessage).toContain('scan-report');
    }
  });

  test('a valid payload survives parsing unchanged', () => {
    const parsed = parseSendRequest(weekly);
    expect(parsed.template).toBe('weekly-summary');
    expect(parsed).toMatchObject({ to: 'ada@example.com', theme: 'dark' });
  });

  test('accepts a first-ever week, where nothing can be compared', () => {
    expect(() =>
      parseSendRequest({
        ...weekly,
        data: {
          dateFrom: '2026-08-07',
          dateTo: '2026-08-13',
          assessments: { count: 0, changePercent: null },
          findings: { count: 0, changePercent: null },
          critical: { count: 0, changePercent: null },
          activeProjects: 0,
        },
      }),
    ).not.toThrow();
  });

  test('a single-day range is legal', () => {
    expect(() =>
      parseSendRequest({
        ...weekly,
        data: { ...weekly.data, dateFrom: '2026-08-07', dateTo: '2026-08-07' },
      }),
    ).not.toThrow();
  });
});

describe('weekly-summary — authentication and abuse', () => {
  test('an unauthenticated request is refused before anything is rendered', async () => {
    const mailer = new FakeMailer();
    const response = await handleSend(sendRequest(weekly, null), testDependencies({ mailer }));

    expect(response.status).toBe(401);
    expect(mailer.sent).toBeEmpty();
  });

  test('a wrong token is refused, and told nothing about why', async () => {
    const mailer = new FakeMailer();
    const response = await handleSend(
      sendRequest(weekly, 'not-the-secret'),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(401);
    expect(mailer.sent).toBeEmpty();
    expect(JSON.stringify(await readJson(response))).not.toContain(TEST_SECRET);
  });
});

describe('scan-report — the fields the completed-scan email added', () => {
  const scan = {
    to: 'ada@example.com',
    template: 'scan-report',
    theme: 'light',
    data: {
      userName: 'Ada',
      projectName: 'DD',
      securityScore: 37,
      riskLevel: 'HIGH',
      totalFindings: 8,
      endpointsEvaluated: 12,
      scanDate: '2026-08-13',
      reportUrl: 'https://app.example.com/reports/abc',
    },
  };

  test('renders the reference summary card', async () => {
    const mailer = new FakeMailer();
    await handleSend(sendRequest(scan), testDependencies({ mailer }));

    const { html } = mailer.lastSent!;
    expect(html).toContain('Assessment completed');
    expect(html).toContain('Hi Ada,');
    expect(html).toContain('DD');
    expect(html).toContain('37 / 100');
    expect(html).toContain('High');
    expect(html).toContain('August 13, 2026');
    expect(html).toContain('8</strong> findings were detected');
    expect(html).toContain('12</strong> endpoints evaluated');
    expect(html).toContain('View Full Report');
  });

  test.each([
    { name: 'an invalid riskLevel', patch: { riskLevel: 'EXTREME' } },
    { name: 'a lowercase riskLevel', patch: { riskLevel: 'high' } },
    { name: 'a score above 100', patch: { securityScore: 101 } },
    { name: 'a negative score', patch: { securityScore: -1 } },
    { name: 'a score that is a string', patch: { securityScore: '37' } },
    { name: 'a malformed scanDate', patch: { scanDate: '13-08-2026' } },
    { name: 'a scanDate with a time', patch: { scanDate: '2026-08-13T21:40:00Z' } },
    { name: 'a negative endpoint count', patch: { endpointsEvaluated: -3 } },
    { name: 'a javascript: report URL', patch: { reportUrl: 'javascript:alert(1)' } },
    { name: 'a userName over the length ceiling', patch: { userName: 'a'.repeat(81) } },
  ])('rejects $name', async ({ patch }) => {
    const mailer = new FakeMailer();
    const response = await handleSend(
      sendRequest({ ...scan, data: { ...scan.data, ...patch } }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(400);
    expect(mailer.sent).toBeEmpty();
  });

  test('a null score is accepted — a scan can legitimately have none', () => {
    expect(() =>
      parseSendRequest({ ...scan, data: { ...scan.data, securityScore: null } }),
    ).not.toThrow();
  });
});
