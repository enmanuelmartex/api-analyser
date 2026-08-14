import { SharedSecretAuthenticator } from '@/lib/auth/shared-secret';
import { DEFAULT_EMAIL_FROM, type RelayConfig } from '@/lib/config/env';
import { silentLogger } from '@/lib/logging/logger';
import { MemoryRateLimiter } from '@/lib/rate-limit/memory-rate-limiter';
import type { RateLimitDecision, RateLimiter } from '@/lib/rate-limit/rate-limiter';
import type { Mailer, MailerResult, OutboundEmail } from '@/lib/resend/mailer';
import type { RelayDependencies } from '@/lib/relay/dependencies';

/**
 * Test double for the provider boundary.
 *
 * This is the guarantee that the suite cannot send a real email: the handler
 * reaches a provider only through `Mailer`, and every test hands it this. There
 * is no network call to accidentally leave un-mocked, and no API key in the
 * environment for one to use.
 */
export class FakeMailer implements Mailer {
  readonly provider = 'fake';
  readonly sent: OutboundEmail[] = [];

  constructor(private readonly result: MailerResult = { ok: true, id: 'email_test_0001' }) {}

  async send(email: OutboundEmail): Promise<MailerResult> {
    this.sent.push(email);
    return this.result;
  }

  get lastSent(): OutboundEmail | undefined {
    return this.sent[this.sent.length - 1];
  }
}

/** A limiter that denies everything, for exercising the 429 path. */
export class AlwaysDenyRateLimiter implements RateLimiter {
  readonly name = 'always-deny';
  readonly distributed = true;

  async consume(): Promise<RateLimitDecision> {
    return { allowed: false, limit: 0, remaining: 0, retryAfterSeconds: 42 };
  }
}

export const TEST_SECRET = 'test-relay-secret-value-not-a-real-one';

/** Stands in for the deployment's own origin. Never a caller-supplied value. */
export const TEST_ASSET_BASE_URL = 'https://mail.example.test';

export function testConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    resendApiKey: 're_not_a_real_key',
    relaySecret: TEST_SECRET,
    emailFrom: DEFAULT_EMAIL_FROM,
    assetBaseUrl: TEST_ASSET_BASE_URL,
    rateLimit: { max: 20, windowSeconds: 60 },
    ...overrides,
  };
}

export function testDependencies(
  overrides: Partial<RelayDependencies> = {},
): RelayDependencies & { mailer: Mailer } {
  const config = overrides.config ?? testConfig();
  return {
    config,
    logger: silentLogger,
    authenticator: new SharedSecretAuthenticator(config.relaySecret),
    mailer: new FakeMailer(),
    rateLimiter: new MemoryRateLimiter(),
    ...overrides,
  };
}

/** A real, minimal PDF: correct magic bytes, and long enough to clear the floor. */
export function samplePdfBase64(sizeBytes = 1024): string {
  const header = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  const filler = Buffer.alloc(Math.max(sizeBytes - header.length, 0), 0x20);
  return Buffer.concat([header, filler]).toString('base64');
}

export interface RequestOptions {
  token?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export function sendReportRequest(options: RequestOptions = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json', ...options.headers });

  const token = options.token === undefined ? TEST_SECRET : options.token;
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  const body =
    options.rawBody ??
    JSON.stringify(
      options.body ?? {
        email: 'security@example.com',
        scanName: 'Production API',
        filename: 'security-report.pdf',
        pdfBase64: samplePdfBase64(),
      },
    );

  return new Request('https://mail.apianalyser.com/api/send-report', {
    method: 'POST',
    headers,
    body,
  });
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
