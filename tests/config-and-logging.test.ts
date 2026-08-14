import { describe, expect, test } from 'bun:test';
import { ConfigurationError, DEFAULT_EMAIL_FROM, loadConfig } from '@/lib/config/env';
import { maskEmail, redactFields, redactSecrets } from '@/lib/logging/redact';

const complete = {
  RESEND_API_KEY: 're_test_key_value',
  RELAY_SECRET: 'test-secret-value',
};

describe('loadConfig', () => {
  test('falls back to the verified sender when EMAIL_FROM is unset', () => {
    expect(loadConfig(complete).emailFrom).toBe(DEFAULT_EMAIL_FROM);
    expect(DEFAULT_EMAIL_FROM).toBe('API Analyzer <reports@notifications.apianalyser.com>');
  });

  test('uses EMAIL_FROM when it is set', () => {
    const config = loadConfig({ ...complete, EMAIL_FROM: 'Relay <relay@example.com>' });
    expect(config.emailFrom).toBe('Relay <relay@example.com>');
  });

  test.each([
    ['RESEND_API_KEY', { RELAY_SECRET: complete.RELAY_SECRET }],
    ['RELAY_SECRET', { RESEND_API_KEY: complete.RESEND_API_KEY }],
  ])('refuses to start without %s', (name, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as ConfigurationError).missing).toContain(name);
    }
  });

  test('treats a blank variable as unset', () => {
    // An empty RELAY_SECRET must not become "no authentication required".
    expect(() => loadConfig({ ...complete, RELAY_SECRET: '   ' })).toThrow(ConfigurationError);
  });

  test('names the missing variable but never a value', () => {
    try {
      loadConfig({ RESEND_API_KEY: 're_secret_that_must_not_leak' });
    } catch (error) {
      expect((error as Error).message).toContain('RELAY_SECRET');
      expect((error as Error).message).not.toContain('re_secret_that_must_not_leak');
    }
  });

  test('enables the distributed limiter only when both Upstash variables are present', () => {
    const partial = loadConfig({ ...complete, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' });
    expect(partial.rateLimit.upstashUrl).toBeUndefined();

    const both = loadConfig({
      ...complete,
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    });
    expect(both.rateLimit.upstashUrl).toBe('https://x.upstash.io');
  });

  test('applies limit defaults and ignores nonsense overrides', () => {
    expect(loadConfig(complete).rateLimit).toMatchObject({ max: 20, windowSeconds: 60 });
    expect(loadConfig({ ...complete, RATE_LIMIT_MAX: 'lots' }).rateLimit.max).toBe(20);
    expect(loadConfig({ ...complete, RATE_LIMIT_MAX: '5' }).rateLimit.max).toBe(5);
  });
});

describe('log redaction', () => {
  test.each([
    'authorization',
    'Authorization',
    'apiKey',
    'api_key',
    'RESEND_API_KEY',
    'relaySecret',
    'token',
    'pdfBase64',
    'attachment',
  ])('strips the %s field', (key) => {
    expect(redactFields({ [key]: 'sensitive' })[key]).toBe('[redacted]');
  });

  test('keeps the fields the logs are actually for', () => {
    // `pdfBytes` next to a forbidden `pdf`, and `contentLength` next to a
    // forbidden `content`: the reason the rule matches whole keys rather than
    // substrings. A substring rule redacts these and makes the logs useless.
    const safe = redactFields({
      requestId: 'abc',
      clientId: 'shared-secret',
      pdfBytes: 1024,
      contentLength: '2048',
      scheme: 'bearer-shared-secret',
      filename: 'report.pdf',
    });

    expect(safe).toEqual({
      requestId: 'abc',
      clientId: 'shared-secret',
      pdfBytes: 1024,
      contentLength: '2048',
      scheme: 'bearer-shared-secret',
      filename: 'report.pdf',
    });
  });

  test.each(['pdf', 'html', 'body', 'attachments', 'installToken'])(
    'still strips the %s field',
    (key) => {
      expect(redactFields({ [key]: 'sensitive' })[key]).toBe('[redacted]');
    },
  );

  test('removes a known secret from free text', () => {
    const message = 'auth failed for key re_live_abcdefghijklmnop';
    expect(redactSecrets(message, ['re_live_abcdefghijklmnop'])).toBe(
      'auth failed for key [redacted]',
    );
  });

  test('ignores secrets too short to match safely', () => {
    // Redacting "abc" everywhere would turn every message into noise.
    expect(redactSecrets('abc def', ['abc'])).toBe('abc def');
  });

  test('tolerates an undefined secret', () => {
    expect(redactSecrets('unchanged', [undefined])).toBe('unchanged');
  });
});

describe('maskEmail', () => {
  test.each([
    ['security@example.com', 'se******@example.com'],
    ['a@example.com', 'a*@example.com'],
    ['ab@example.com', 'ab*@example.com'],
  ])('masks %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  test('keeps the domain, for correlating a delivery complaint', () => {
    expect(maskEmail('someone@corp.example')).toEndWith('@corp.example');
  });

  test('does not throw on nonsense', () => {
    expect(maskEmail('not-an-email')).toBe('[invalid address]');
  });
});
