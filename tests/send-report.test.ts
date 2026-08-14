import { describe, expect, test } from 'bun:test';
import { DEFAULT_EMAIL_FROM } from '@/lib/config/env';
import { MAX_PDF_BYTES, MAX_REQUEST_BYTES } from '@/lib/limits';
import { handleSendReport } from '@/lib/relay/send-report-handler';
import {
  AlwaysDenyRateLimiter,
  FakeMailer,
  readJson,
  samplePdfBase64,
  sendReportRequest,
  testDependencies,
} from './helpers';

describe('POST /api/send-report — authentication', () => {
  test('rejects a request with no Authorization header', async () => {
    const mailer = new FakeMailer();
    const response = await handleSendReport(
      sendReportRequest({ token: null }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ success: false, error: 'Unauthorized' });
    expect(mailer.sent).toHaveLength(0);
  });

  test('rejects an incorrect bearer token', async () => {
    const mailer = new FakeMailer();
    const response = await handleSendReport(
      sendReportRequest({ token: 'wrong-token' }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(401);
    expect(mailer.sent).toHaveLength(0);
  });

  test('rejects a non-bearer Authorization scheme', async () => {
    const response = await handleSendReport(
      sendReportRequest({ token: null, headers: { Authorization: 'Basic dXNlcjpwYXNz' } }),
      testDependencies(),
    );

    expect(response.status).toBe(401);
  });

  test('does not disclose why authentication failed', async () => {
    const missing = await readJson(
      await handleSendReport(sendReportRequest({ token: null }), testDependencies()),
    );
    const wrong = await readJson(
      await handleSendReport(sendReportRequest({ token: 'nope' }), testDependencies()),
    );

    // Identical responses: a prober learns nothing about which half is wrong.
    expect(missing).toEqual(wrong);
  });
});

describe('POST /api/send-report — validation', () => {
  const cases: { name: string; body: Record<string, unknown>; status: number }[] = [
    {
      name: 'an invalid email address',
      body: { email: 'not-an-email', filename: 'r.pdf', pdfBase64: samplePdfBase64() },
      status: 400,
    },
    {
      name: 'a missing email',
      body: { filename: 'r.pdf', pdfBase64: samplePdfBase64() },
      status: 400,
    },
    {
      name: 'a missing PDF',
      body: { email: 'security@example.com', filename: 'r.pdf' },
      status: 400,
    },
    {
      name: 'an empty PDF',
      body: { email: 'security@example.com', filename: 'r.pdf', pdfBase64: '' },
      status: 400,
    },
    {
      name: 'a filename that is not a PDF',
      body: {
        email: 'security@example.com',
        filename: 'report.html',
        pdfBase64: samplePdfBase64(),
      },
      status: 400,
    },
    {
      name: 'a missing filename',
      body: { email: 'security@example.com', pdfBase64: samplePdfBase64() },
      status: 400,
    },
    {
      name: 'base64 that is not base64',
      body: {
        email: 'security@example.com',
        filename: 'r.pdf',
        pdfBase64: 'this is definitely not base64!!',
      },
      status: 400,
    },
    {
      name: 'valid base64 of something that is not a PDF',
      body: {
        email: 'security@example.com',
        filename: 'r.pdf',
        pdfBase64: Buffer.from('<html><script>alert(1)</script></html>'.repeat(4)).toString(
          'base64',
        ),
      },
      status: 400,
    },
    {
      name: 'a line break in the scan name (header injection)',
      body: {
        email: 'security@example.com',
        scanName: 'API\r\nBcc: victim@example.com',
        filename: 'r.pdf',
        pdfBase64: samplePdfBase64(),
      },
      status: 400,
    },
    {
      name: 'unknown fields',
      body: {
        email: 'security@example.com',
        filename: 'r.pdf',
        pdfBase64: samplePdfBase64(),
        html: '<h1>caller-supplied markup</h1>',
      },
      status: 400,
    },
  ];

  for (const { name, body, status } of cases) {
    test(`rejects ${name} with ${status}`, async () => {
      const mailer = new FakeMailer();
      const response = await handleSendReport(
        sendReportRequest({ body }),
        testDependencies({ mailer }),
      );

      expect(response.status).toBe(status);
      expect((await readJson(response)).success).toBe(false);
      expect(mailer.sent).toHaveLength(0);
    });
  }

  test('rejects a body that is not valid JSON with 400', async () => {
    const response = await handleSendReport(
      sendReportRequest({ rawBody: '{"email": "a@b.com",' }),
      testDependencies(),
    );

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('Request body is not valid JSON');
  });

  test('rejects an empty body with 400', async () => {
    const response = await handleSendReport(
      sendReportRequest({ rawBody: '' }),
      testDependencies(),
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /api/send-report — size limits', () => {
  test('rejects an oversized PDF with 413', async () => {
    const mailer = new FakeMailer();
    const response = await handleSendReport(
      sendReportRequest({
        body: {
          email: 'security@example.com',
          filename: 'huge.pdf',
          pdfBase64: samplePdfBase64(MAX_PDF_BYTES + 1024),
        },
      }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(413);
    expect((await readJson(response)).error).toContain('3 MB');
    expect(mailer.sent).toHaveLength(0);
  });

  test('rejects an oversized request from Content-Length alone, without reading it', async () => {
    const response = await handleSendReport(
      sendReportRequest({
        headers: { 'content-length': String(MAX_REQUEST_BYTES + 1) },
      }),
      testDependencies(),
    );

    expect(response.status).toBe(413);
  });

  test('accepts a PDF just under the limit', async () => {
    const mailer = new FakeMailer();
    const response = await handleSendReport(
      sendReportRequest({
        body: {
          email: 'security@example.com',
          filename: 'big.pdf',
          pdfBase64: samplePdfBase64(MAX_PDF_BYTES - 1024),
        },
      }),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('POST /api/send-report — rate limiting', () => {
  test('returns 429 with a Retry-After header when the limiter denies', async () => {
    const mailer = new FakeMailer();
    const response = await handleSendReport(
      sendReportRequest(),
      testDependencies({ mailer, rateLimiter: new AlwaysDenyRateLimiter() }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(mailer.sent).toHaveLength(0);
  });

  test('denies the request before the body is parsed', async () => {
    // Unparseable body, but the limiter runs first, so the answer is 429.
    const response = await handleSendReport(
      sendReportRequest({ rawBody: 'not json at all' }),
      testDependencies({ rateLimiter: new AlwaysDenyRateLimiter() }),
    );

    expect(response.status).toBe(429);
  });

  test('an unauthenticated request never reaches the limiter', async () => {
    let consumed = 0;
    const counting = {
      name: 'counting',
      distributed: true,
      async consume() {
        consumed += 1;
        return { allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 };
      },
    };

    await handleSendReport(
      sendReportRequest({ token: null }),
      testDependencies({ rateLimiter: counting }),
    );

    expect(consumed).toBe(0);
  });
});

describe('POST /api/send-report — a valid request', () => {
  test('calls the mail service with a server-built message and returns the id', async () => {
    const mailer = new FakeMailer({ ok: true, id: 'email_abc123' });
    const response = await handleSendReport(
      sendReportRequest(),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      success: true,
      message: 'Report email sent',
      emailId: 'email_abc123',
    });

    expect(mailer.sent).toHaveLength(1);
    const sent = mailer.lastSent!;
    expect(sent.from).toBe(DEFAULT_EMAIL_FROM);
    expect(sent.to).toBe('security@example.com');
    expect(sent.subject).toBe('Security Report - Production API');
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.filename).toBe('security-report.pdf');
    expect(Buffer.isBuffer(sent.attachments[0]!.content)).toBe(true);
    expect(sent.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('sends the base64 payload through as the exact original bytes', async () => {
    const mailer = new FakeMailer();
    const pdfBase64 = samplePdfBase64(2048);

    await handleSendReport(
      sendReportRequest({
        body: { email: 'a@example.com', filename: 'r.pdf', pdfBase64 },
      }),
      testDependencies({ mailer }),
    );

    expect(mailer.lastSent!.attachments[0]!.content.toString('base64')).toBe(pdfBase64);
  });

  test('falls back to the generic subject when scanName is absent', async () => {
    const mailer = new FakeMailer();
    await handleSendReport(
      sendReportRequest({
        body: {
          email: 'a@example.com',
          filename: 'report.pdf',
          pdfBase64: samplePdfBase64(),
        },
      }),
      testDependencies({ mailer }),
    );

    expect(mailer.lastSent!.subject).toBe('API Security Report');
  });

  test('uses the configured EMAIL_FROM when one is set', async () => {
    const mailer = new FakeMailer();
    const deps = testDependencies({ mailer });

    await handleSendReport(
      sendReportRequest(),
      { ...deps, config: { ...deps.config, emailFrom: 'Custom <custom@example.com>' } },
    );

    expect(mailer.lastSent!.from).toBe('Custom <custom@example.com>');
  });

  test('sanitises a dangerous filename before attaching it', async () => {
    const mailer = new FakeMailer();
    await handleSendReport(
      sendReportRequest({
        body: {
          email: 'a@example.com',
          filename: '../../../etc/passwd/Q3 report ~2024~.pdf',
          pdfBase64: samplePdfBase64(),
        },
      }),
      testDependencies({ mailer }),
    );

    const filename = mailer.lastSent!.attachments[0]!.filename;
    expect(filename).toBe('Q3-report-2024.pdf');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('..');
  });
});

describe('POST /api/send-report — failure handling', () => {
  test('returns a generic 500 when the provider rejects the message', async () => {
    const mailer = new FakeMailer({
      ok: false,
      reason: 'Domain notifications.apianalyser.com is not verified',
      retryable: false,
    });

    const response = await handleSendReport(
      sendReportRequest(),
      testDependencies({ mailer }),
    );

    expect(response.status).toBe(500);
    // The provider's own words never reach the caller.
    expect(await readJson(response)).toEqual({
      success: false,
      error: 'Unable to send report email',
    });
  });

  test('returns a generic 500 when something unexpected throws', async () => {
    const exploding = {
      provider: 'exploding',
      async send(): Promise<never> {
        throw new Error('socket hang up at 10.0.0.1:6379');
      },
    };

    const response = await handleSendReport(
      sendReportRequest(),
      testDependencies({ mailer: exploding }),
    );

    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body.error).toBe('Unable to send report email');
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
  });

  test('no response body ever carries a stack trace or an internal detail', async () => {
    const responses = await Promise.all([
      handleSendReport(sendReportRequest({ token: null }), testDependencies()),
      handleSendReport(sendReportRequest({ rawBody: '{' }), testDependencies()),
      handleSendReport(
        sendReportRequest(),
        testDependencies({
          mailer: new FakeMailer({ ok: false, reason: 're_live_key_leaked', retryable: false }),
        }),
      ),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain('at ');
      expect(text).not.toContain('re_');
      expect(text).not.toContain('lib/');
    }
  });
});
