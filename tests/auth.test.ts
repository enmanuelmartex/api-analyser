import { describe, expect, test } from 'bun:test';
import { readBearerToken, secureCompare } from '@/lib/auth/bearer';
import { SHARED_SECRET_CLIENT_ID, SharedSecretAuthenticator } from '@/lib/auth/shared-secret';

const SECRET = 'a-secret-that-is-long-enough-to-be-plausible';

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://mail.apianalyser.com/api/send-report', {
    method: 'POST',
    headers,
  });
}

describe('readBearerToken', () => {
  test('reads a well-formed header', () => {
    expect(readBearerToken(requestWith({ Authorization: 'Bearer abc123' }))).toBe('abc123');
  });

  test('is case-insensitive about the scheme', () => {
    expect(readBearerToken(requestWith({ Authorization: 'bearer abc123' }))).toBe('abc123');
  });

  test('tolerates extra whitespace', () => {
    expect(readBearerToken(requestWith({ Authorization: '  Bearer   abc123  ' }))).toBe('abc123');
  });

  test.each([
    ['no header', {}],
    ['a different scheme', { Authorization: 'Basic abc123' }],
    ['an empty token', { Authorization: 'Bearer ' }],
    ['the scheme alone', { Authorization: 'Bearer' }],
  ])('returns null for %s', (_label, headers) => {
    expect(readBearerToken(requestWith(headers as Record<string, string>))).toBeNull();
  });
});

describe('secureCompare', () => {
  test('accepts identical strings', () => {
    expect(secureCompare(SECRET, SECRET)).toBe(true);
  });

  test('rejects a near-miss', () => {
    expect(secureCompare(SECRET, `${SECRET}x`)).toBe(false);
    expect(secureCompare(SECRET, SECRET.toUpperCase())).toBe(false);
  });

  test('handles differing lengths without throwing', () => {
    // The reason both sides are hashed first: `timingSafeEqual` requires equal
    // lengths, and length-checking before it leaks the secret's length.
    expect(secureCompare('short', SECRET)).toBe(false);
    expect(secureCompare('', SECRET)).toBe(false);
  });
});

describe('SharedSecretAuthenticator', () => {
  const authenticator = new SharedSecretAuthenticator(SECRET);

  test('refuses to be constructed without a secret', () => {
    // An unset RELAY_SECRET must never degrade into "no authentication".
    expect(() => new SharedSecretAuthenticator('')).toThrow();
  });

  test('accepts the correct token and reports a stable client id', () => {
    const result = authenticator.authenticate(requestWith({ Authorization: `Bearer ${SECRET}` }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.clientId).toBe(SHARED_SECRET_CLIENT_ID);
      expect(result.context.scheme).toBe('bearer-shared-secret');
    }
  });

  test('rejects a wrong token, with a reason kept for the log', () => {
    const result = authenticator.authenticate(requestWith({ Authorization: 'Bearer wrong' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('did not match');
  });

  test('rejects a missing header', () => {
    const result = authenticator.authenticate(requestWith({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('missing');
  });

  test('never echoes the secret in a failure reason', () => {
    const result = authenticator.authenticate(requestWith({ Authorization: `Bearer ${SECRET}x` }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain(SECRET);
  });
});
