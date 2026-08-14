import { afterEach, describe, expect, it } from 'bun:test';
import { RelayTransport } from './relay.transport';
import type { OutboundMessage } from './mail-transport';

/**
 * The hosted-relay transport.
 *
 * What matters here is the failure taxonomy. This runs inside a queue worker,
 * and the difference between "retry this" and "this will never work" decides
 * whether a report email is attempted three more times or recorded once with a
 * reason an operator can act on.
 */

const URL_BASE = 'https://mail.apianalyser.com';
const TOKEN = 'relay_token_that_is_long_enough';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface StubOptions {
  status?: number;
  body?: unknown;
  throws?: Error;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    if (options.throws) throw options.throws;

    const status = options.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => options.body ?? { success: true, emailId: 'email_relay_1' },
    } as unknown as Response;
  }) as typeof fetch;

  return calls;
}

const MESSAGE: OutboundMessage = {
  to: 'security@corp.example',
  subject: 'Scan complete — Production API',
  html: '<p>rendered locally</p>',
  text: 'rendered locally',
  relay: {
    template: 'scan-report',
    data: { projectName: 'Production API', securityScore: 74 },
  },
};

describe('RelayTransport.isConfigured', () => {
  it('needs both a URL and a token', () => {
    expect(new RelayTransport(URL_BASE, TOKEN).isConfigured()).toBe(true);
    expect(new RelayTransport(URL_BASE, '').isConfigured()).toBe(false);
    expect(new RelayTransport('', TOKEN).isConfigured()).toBe(false);
  });
});

describe('RelayTransport.send', () => {
  it('posts the template and its data, with the bearer token', async () => {
    const calls = stubFetch();

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result).toEqual({ ok: true, providerMessageId: 'email_relay_1' });
    expect(calls[0].url).toBe('https://mail.apianalyser.com/api/send');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);

    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({
      to: 'security@corp.example',
      template: 'scan-report',
      data: { projectName: 'Production API', securityScore: 74 },
    });
  });

  it('never sends the locally rendered HTML', async () => {
    const calls = stubFetch();

    await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    // The relay renders its own templates and rejects unknown fields; sending
    // our HTML would be a 400 even if it were willing to accept markup.
    const body = calls[0].init.body as string;
    expect(body).not.toContain('rendered locally');
    expect(body).not.toContain('subject');
  });

  it('tolerates a trailing slash on the configured URL', async () => {
    const calls = stubFetch();

    await new RelayTransport(`${URL_BASE}/`, TOKEN).send(MESSAGE);

    expect(calls[0].url).toBe('https://mail.apianalyser.com/api/send');
  });

  it('base64-encodes an attachment for scan-report', async () => {
    const calls = stubFetch();
    const content = Buffer.from('%PDF-1.7 bytes');

    await new RelayTransport(URL_BASE, TOKEN).send({
      ...MESSAGE,
      attachments: [{ filename: 'report.pdf', content }],
    });

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.attachment).toEqual({
      filename: 'report.pdf',
      contentBase64: content.toString('base64'),
    });
  });

  it('drops an attachment on a template that cannot carry one', async () => {
    const calls = stubFetch();

    await new RelayTransport(URL_BASE, TOKEN).send({
      ...MESSAGE,
      relay: { template: 'scan-failed', data: { projectName: 'X', reason: 'timeout' } },
      attachments: [{ filename: 'report.pdf', content: Buffer.from('%PDF-') }],
    });

    // Sending one would earn a 400 rather than an email.
    expect(JSON.parse(calls[0].init.body as string).attachment).toBeUndefined();
  });

  it('refuses a message with no relay payload, without calling the relay', async () => {
    const calls = stubFetch();
    const { relay: _omitted, ...withoutRelay } = MESSAGE;

    const result = await new RelayTransport(URL_BASE, TOKEN).send(withoutRelay as OutboundMessage);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    if (!result.ok) {
      // Non-retryable: the message will never gain a payload by being retried.
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('relay template');
    }
  });

  it('refuses an attachment over the relay limit before uploading it', async () => {
    const calls = stubFetch();

    const result = await new RelayTransport(URL_BASE, TOKEN).send({
      ...MESSAGE,
      attachments: [{ filename: 'huge.pdf', content: Buffer.alloc(4 * 1024 * 1024) }],
    });

    expect(result.ok).toBe(false);
    // Checked locally, so a 4 MB upload is not spent discovering a 413.
    expect(calls).toHaveLength(0);
    if (!result.ok) expect(result.reason).toContain('3MB');
  });
});

describe('RelayTransport failure taxonomy', () => {
  it('treats a network fault as retryable', async () => {
    stubFetch({ throws: new Error('getaddrinfo ENOTFOUND') });

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [413, false],
  ])('marks %i as retryable=%p', async (status, retryable) => {
    stubFetch({ status, body: { success: false, error: 'nope' } });

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result).toMatchObject({ ok: false, retryable });
  });

  it('treats a 200 that is not a success as a failure', async () => {
    stubFetch({ status: 200, body: { success: false, error: 'something odd' } });

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result.ok).toBe(false);
  });

  it('survives a response body that is not JSON', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response) as typeof fetch;

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it('never lets the token reach the reason it returns', async () => {
    // The reason is written to a database column and to the logs.
    stubFetch({ status: 401, body: { success: false, error: `bad token ${TOKEN}` } });

    const result = await new RelayTransport(URL_BASE, TOKEN).send(MESSAGE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain(TOKEN);
      expect(result.reason).toContain('[redacted]');
    }
  });
});
