import { describe, expect, it } from 'bun:test';
import { REDACTED } from '../../common/utils/redact.util';
import { sanitizeLogEvent, sanitizeMetadata } from './log-sanitizer';
import type { LogEventInput } from './log-event.types';

/**
 * These are the tests that matter most in this module.
 *
 * The audit log is written on every request and every worker step, and it is
 * the one table an operator reads without thinking about what might be in it.
 * A credential that reaches it is stored in plaintext, replicated into every
 * backup, and shown in the UI to anyone who can open Settings.
 */

function event(overrides: Partial<LogEventInput> = {}): LogEventInput {
  return {
    event: 'api.request',
    category: 'API',
    ...overrides,
  };
}

describe('sanitizeMetadata', () => {
  it('redacts values whose key names a credential', () => {
    const result = sanitizeMetadata({
      password: 'hunter2',
      apiKey: 'sk-live-abcdef123456',
      token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      email: 'operator@example.com',
    })!;

    expect(result.password).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.token).toBe(REDACTED);
    // Not a credential — redacting it would make the trail useless.
    expect(result.email).toBe('operator@example.com');
  });

  it('redacts nested credentials', () => {
    const result = sanitizeMetadata({
      request: { headers: { authorization: 'Bearer abc123def456' } },
    })!;

    expect((result.request as any).headers.authorization).toBe(REDACTED);
  });

  it('replaces oversized payloads with a marker rather than truncating the JSON', () => {
    // Half a JSON document is not JSON, and a viewer that cannot parse it shows
    // the operator nothing at all.
    const result = sanitizeMetadata({ blob: 'x'.repeat(20_000) })!;

    expect(result._truncated).toBe(true);
    expect(result.blob).toBeUndefined();
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('records that a cyclic payload could not be stored instead of throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    const result = sanitizeMetadata(cyclic)!;

    expect(result._error).toBeDefined();
  });

  it('returns undefined when there is no metadata', () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });
});

describe('sanitizeLogEvent', () => {
  it('redacts the SSE token that EventSource must pass in the query string', () => {
    // EventSource cannot set an Authorization header, so the live-log and
    // scan-progress streams carry a real JWT in the URL. That URL is the
    // `route` of the event recording the request.
    const result = sanitizeLogEvent(
      event({ route: '/api/v1/audit/logs/stream?token=eyJhbGciOiJIUzI1NiJ9.abc.def&severity=ERROR' }),
    );

    expect(result.route).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result.route).toContain(REDACTED);
    // Structure is preserved: the non-sensitive parameter survives.
    expect(result.route).toContain('severity=ERROR');
  });

  it('redacts credentials quoted inside a free-text message', () => {
    const result = sanitizeLogEvent(
      event({ message: 'Upstream rejected the call: Authorization: Bearer sk-live-abcdef123456' }),
    );

    expect(result.message).not.toContain('sk-live-abcdef123456');
    expect(result.message).toContain(REDACTED);
  });

  it('redacts a secret interpolated into a stack trace', () => {
    const result = sanitizeLogEvent(
      event({
        stackTrace:
          'Error: request failed\n    at fetch (/app/src/http.ts:12)\n    url=https://api.example.com/v1?api_key=abcdef123456',
      }),
    );

    expect(result.stackTrace).not.toContain('abcdef123456');
  });

  it('caps an attacker-controlled user agent', () => {
    const result = sanitizeLogEvent(event({ userAgent: 'A'.repeat(5_000) }));

    expect(result.userAgent!.length).toBeLessThan(600);
    expect(result.userAgent).toContain('truncated');
  });

  it('caps a very long message', () => {
    const result = sanitizeLogEvent(event({ message: 'B'.repeat(10_000) }));

    expect(result.message!.length).toBeLessThan(2_100);
  });

  it('leaves an ordinary event untouched', () => {
    const input = event({
      message: 'Scan completed for Production API',
      route: '/api/v1/assessments/abc123',
      userAgent: 'Mozilla/5.0',
      metadata: { findingsCount: 4, criticalCount: 0 },
    });

    const result = sanitizeLogEvent(input);

    expect(result.message).toBe(input.message);
    expect(result.route).toBe(input.route);
    expect(result.userAgent).toBe(input.userAgent);
    expect(result.metadata).toEqual(input.metadata!);
  });
});
