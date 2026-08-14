import { describe, expect, test } from 'bun:test';
import { handleSend } from '@/lib/relay/send-handler';
import {
  AlwaysDenyRateLimiter,
  FakeMailer,
  readJson,
  samplePdfBase64,
  TEST_SECRET,
  testDependencies,
} from './helpers';

function sendRequest(body: unknown, token: string | null = TEST_SECRET): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  return new Request('https://mail.apianalyser.com/api/send', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const scanReport = {
  to: 'security@example.com',
  template: 'scan-report',
  data: {
    projectName: 'Production API',
    securityScore: 72,
    counts: { critical: 1, high: 3, medium: 2, low: 5, info: 0 },
    totalFindings: 11,
    reportUrl: 'https://app.example.com/reports/abc123',
  },
  attachment: { filename: 'security-report.pdf', contentBase64: samplePdfBase64() },
};

const scanFailed = {
  to: 'security@example.com',
  template: 'scan-failed',
  data: {
    projectName: 'Production API',
    reason: 'The target refused the connection after 3 attempts',
    scanUrl: 'https://app.example.com/assessments/xyz',
    scheduleName: 'Weekly Production Scan',
  },
};

const criticalFinding = {
  to: 'security@example.com',
  template: 'critical-finding',
  data: {
    projectName: 'Production API',
    criticalCount: 2,
    issuesUrl: 'https://app.example.com/issues?severity=CRITICAL',
  },
};

describe('POST /api/send — authentication', () => {
  test.each([
    ['no token', null],
    ['a wrong token', 'nope'],
  ])('rejects %s with 401 and sends nothing', async (_label, token) => {
    const mailer = new FakeMailer();
    const response = await handleSend(
      sendRequest(scanReport, token as string | null),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(401);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('POST /api/send — scan-report', () => {
  test('sends the report with its attachment and returns the id', async () => {
    const mailer = new FakeMailer({ ok: true, id: 'email_send_1' });
    const response = await handleSend(sendRequest(scanReport), testDependencies({ mailer }));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      success: true,
      message: 'Report email sent',
      emailId: 'email_send_1',
    });

    const sent = mailer.lastSent!;
    expect(sent.subject).toBe('Assessment completed — API Analyzer');
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.filename).toBe('security-report.pdf');
    expect(sent.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('renders the score, the breakdown and the link', async () => {
    const mailer = new FakeMailer();
    await handleSend(sendRequest(scanReport), testDependencies({ mailer }));

    const { html, text } = mailer.lastSent!;
    expect(html).toContain('72 / 100');
    expect(html).toContain('Critical');
    expect(html).toContain('https://app.example.com/reports/abc123');
    expect(text).toContain('Score:    72 / 100');
    expect(text).toContain('Critical');
  });

  test('works with no attachment at all', async () => {
    const mailer = new FakeMailer();
    const { attachment: _dropped, ...withoutAttachment } = scanReport;

    const response = await handleSend(
      sendRequest(withoutAttachment),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(200);
    expect(mailer.lastSent!.attachments).toHaveLength(0);
    // The copy must not promise a PDF that is not there.
    expect(mailer.lastSent!.html).not.toContain('attached to this email');
  });

  test('works with only the project name', async () => {
    const mailer = new FakeMailer();
    const response = await handleSend(
      sendRequest({ to: 'a@example.com', template: 'scan-report', data: { projectName: 'X' } }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(200);
    expect(mailer.lastSent!.subject).toBe('Assessment completed — API Analyzer');
  });

  test('sanitises the attachment filename', async () => {
    const mailer = new FakeMailer();
    await handleSend(
      sendRequest({
        ...scanReport,
        attachment: { filename: '../../etc/report.pdf', contentBase64: samplePdfBase64() },
      }),
      testDependencies({ mailer }),
    );

    expect(mailer.lastSent!.attachments[0]!.filename).toBe('report.pdf');
  });
});

describe('POST /api/send — scan-failed', () => {
  test('sends, with the reason and the schedule name', async () => {
    const mailer = new FakeMailer();
    const response = await handleSend(sendRequest(scanFailed), testDependencies({ mailer }));

    expect(response.status).toBe(200);
    const sent = mailer.lastSent!;
    expect(sent.subject).toBe('Assessment failed — API Analyzer');
    expect(sent.html).toContain('refused the connection');
    expect(sent.html).toContain('Weekly Production Scan');
    expect(sent.text).toContain('refused the connection');
    expect(sent.attachments).toHaveLength(0);
  });

  test('rejects an attachment, which this template cannot render', async () => {
    const response = await handleSend(
      sendRequest({
        ...scanFailed,
        attachment: { filename: 'r.pdf', contentBase64: samplePdfBase64() },
      }),
      testDependencies(),
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /api/send — critical-finding', () => {
  /*
   * The subject is a constant now and carries neither the count nor the project
   * name — a subject assembled from request data is a subject the caller
   * steers, and this is the message most worth spoofing. The plural logic still
   * exists; it moved into the body, which is where this asserts it.
   */
  test('keeps the count out of the subject and gets the plural right in the body', async () => {
    const mailer = new FakeMailer();
    await handleSend(sendRequest(criticalFinding), testDependencies({ mailer }));

    expect(mailer.lastSent!.subject).toBe('Critical findings detected — API Analyzer');
    expect(mailer.lastSent!.subject).not.toContain('Production API');
    expect(mailer.lastSent!.html).toContain('2 critical vulnerabilities');

    await handleSend(
      sendRequest({ ...criticalFinding, data: { ...criticalFinding.data, criticalCount: 1 } }),
      testDependencies({ mailer }),
    );

    expect(mailer.lastSent!.subject).toBe('Critical findings detected — API Analyzer');
    expect(mailer.lastSent!.html).toContain('1 critical vulnerability');
  });
});

describe('POST /api/send — validation', () => {
  const cases: { name: string; body: unknown }[] = [
    { name: 'an unknown template', body: { ...scanReport, template: 'anything-i-like' } },
    { name: 'a missing template', body: { to: 'a@example.com', data: { projectName: 'X' } } },
    { name: 'an invalid recipient', body: { ...criticalFinding, to: 'not-an-email' } },
    {
      name: 'a missing projectName',
      body: { to: 'a@example.com', template: 'scan-report', data: {} },
    },
    {
      name: 'scan-failed without a reason',
      body: { to: 'a@example.com', template: 'scan-failed', data: { projectName: 'X' } },
    },
    {
      name: 'an unknown data field',
      body: {
        to: 'a@example.com',
        template: 'critical-finding',
        data: { projectName: 'X', criticalCount: 1, extra: 'nope' },
      },
    },
    {
      name: 'a caller-supplied html field',
      body: { ...criticalFinding, html: '<h1>phish</h1>' },
    },
    {
      name: 'a caller-supplied subject',
      body: { ...criticalFinding, subject: 'Anything I like' },
    },
    {
      name: 'a caller-supplied sender',
      body: { ...criticalFinding, from: 'ceo@bank.example' },
    },
    {
      name: 'a line break in the project name',
      body: {
        ...criticalFinding,
        data: { ...criticalFinding.data, projectName: 'X\r\nBcc: victim@example.com' },
      },
    },
    {
      name: 'a malformed URL',
      body: { ...criticalFinding, data: { ...criticalFinding.data, issuesUrl: 'not a url' } },
    },
    {
      name: 'a negative count',
      body: { ...criticalFinding, data: { ...criticalFinding.data, criticalCount: -5 } },
    },
    {
      name: 'a score outside 0-100',
      body: { ...scanReport, data: { ...scanReport.data, securityScore: 900 } },
    },
  ];

  for (const { name, body } of cases) {
    test(`rejects ${name} with 400`, async () => {
      const mailer = new FakeMailer();
      const response = await handleSend(sendRequest(body), testDependencies({ mailer }));

      expect(response.status).toBe(400);
      expect((await readJson(response)).success).toBe(false);
      expect(mailer.sent).toHaveLength(0);
    });
  }

  test('rejects an oversized attachment with 413', async () => {
    const response = await handleSend(
      sendRequest({
        ...scanReport,
        attachment: {
          filename: 'huge.pdf',
          contentBase64: samplePdfBase64(4 * 1024 * 1024),
        },
      }),
      testDependencies(),
    );

    expect(response.status).toBe(413);
  });

  test('rejects invalid JSON with 400', async () => {
    const response = await handleSend(sendRequest('{"to":'), testDependencies());
    expect(response.status).toBe(400);
  });
});

describe('POST /api/send — the caller cannot control the message', () => {
  test('a javascript: URL never reaches the rendered email', async () => {
    const mailer = new FakeMailer();
    // Rejected by the schema, but assert the outcome rather than the mechanism:
    // this must stay true however the schema is refactored.
    const response = await handleSend(
      sendRequest({
        ...criticalFinding,
        data: { ...criticalFinding.data, issuesUrl: 'javascript:alert(1)' },
      }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(400);
    expect(mailer.sent).toHaveLength(0);
  });

  test('markup in a project name is escaped, not rendered', async () => {
    const mailer = new FakeMailer();
    await handleSend(
      sendRequest({
        ...criticalFinding,
        data: { ...criticalFinding.data, projectName: '<img src=x onerror="alert(1)">' },
      }),
      testDependencies({ mailer }),
    );

    expect(mailer.lastSent!.html).not.toContain('<img src=x');
    expect(mailer.lastSent!.html).toContain('&lt;img src=x');
  });

  test('the sender is always the configured one', async () => {
    const mailer = new FakeMailer();
    await handleSend(sendRequest(criticalFinding), testDependencies({ mailer }));

    expect(mailer.lastSent!.from).toBe('API Analyzer <reports@notifications.apianalyser.com>');
  });
});

describe('POST /api/send — failure handling', () => {
  test('returns 429 when rate limited', async () => {
    const response = await handleSend(
      sendRequest(criticalFinding),
      testDependencies({ rateLimiter: new AlwaysDenyRateLimiter() }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
  });

  test('returns a generic 500 when the provider rejects it', async () => {
    const mailer = new FakeMailer({
      ok: false,
      reason: 'Domain notifications.apianalyser.com is not verified',
      retryable: false,
    });

    const response = await handleSend(sendRequest(criticalFinding), testDependencies({ mailer }));

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      success: false,
      error: 'Unable to send report email',
    });
  });
});
