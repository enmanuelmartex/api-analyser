import { describe, expect, it } from 'bun:test';
import { getAllowedOrigins, isOriginAllowed } from './cors.util';

describe('getAllowedOrigins', () => {
  it('falls back to FRONTEND_URL when CORS_ALLOWED_ORIGINS is unset', () => {
    expect(getAllowedOrigins({ FRONTEND_URL: 'https://app.example.com' } as any)).toEqual([
      'https://app.example.com',
    ]);
  });

  it('defaults to localhost:3000 when nothing is configured', () => {
    expect(getAllowedOrigins({} as any)).toEqual(['http://localhost:3000']);
  });

  it('parses a comma-separated list from CORS_ALLOWED_ORIGINS, ignoring FRONTEND_URL', () => {
    const env = {
      FRONTEND_URL: 'https://ignored.example.com',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://staging.example.com',
    } as any;

    expect(getAllowedOrigins(env)).toEqual([
      'https://app.example.com',
      'https://staging.example.com',
    ]);
  });

  it('strips a trailing slash so a pasted URL still matches a bare Origin header', () => {
    expect(getAllowedOrigins({ FRONTEND_URL: 'https://app.example.com/' } as any)).toEqual([
      'https://app.example.com',
    ]);
  });

  it('de-duplicates repeated origins', () => {
    const env = { CORS_ALLOWED_ORIGINS: 'https://a.example.com,https://a.example.com' } as any;
    expect(getAllowedOrigins(env)).toEqual(['https://a.example.com']);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://app.example.com', 'https://staging.example.com'];

  it('accepts an origin on the allowlist', () => {
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
  });

  it('rejects an arbitrary origin not on the allowlist', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
  });

  it('rejects a subdomain trick that merely contains a trusted origin', () => {
    expect(isOriginAllowed('https://app.example.com.evil.com', allowed)).toBe(false);
  });

  it('rejects an absent origin (callers decide separately whether to allow no-Origin requests)', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });
});
