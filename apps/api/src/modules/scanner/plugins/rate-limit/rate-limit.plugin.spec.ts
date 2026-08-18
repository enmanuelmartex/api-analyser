import { describe, expect, it } from 'bun:test';
import { hasRateLimitHeaders, isSensitiveEndpoint } from './rate-limit.plugin';

/**
 * This check only probes the first 3 GET/POST endpoints it sees, so whether
 * login/register land in that first 3 depends entirely on this
 * prioritization. Without it, a spec that lists a dozen ordinary endpoints
 * before `/auth/login` would never have its login route tested for missing
 * rate limiting at all — the exact coverage gap opened by excluding login
 * from the business-flow check's own classification (see
 * business-flow-classifier.ts's `isAuthenticationPath`).
 */
describe('isSensitiveEndpoint', () => {
  it('recognises login, register and token-exchange paths', () => {
    expect(isSensitiveEndpoint('/auth/login')).toBe(true);
    expect(isSensitiveEndpoint('/auth/register')).toBe(true);
    expect(isSensitiveEndpoint('/oauth/token')).toBe(true);
    expect(isSensitiveEndpoint('/auth/signin')).toBe(true);
    expect(isSensitiveEndpoint('/auth/sign-in')).toBe(true);
    expect(isSensitiveEndpoint('/auth/signup')).toBe(true);
    expect(isSensitiveEndpoint('/auth/sign-up')).toBe(true);
  });

  it('recognises password and MFA/OTP operations', () => {
    expect(isSensitiveEndpoint('/account/password')).toBe(true);
    expect(isSensitiveEndpoint('/auth/mfa/verify')).toBe(true);
    expect(isSensitiveEndpoint('/auth/otp')).toBe(true);
  });

  it('does not flag an ordinary endpoint', () => {
    expect(isSensitiveEndpoint('/v1/widgets')).toBe(false);
    expect(isSensitiveEndpoint('/v1/orders/{id}')).toBe(false);
  });

  it('matches whole tokens only, not substrings', () => {
    // "/tokenized-values" contains "token" as a substring but is not one.
    expect(isSensitiveEndpoint('/tokenized-values')).toBe(false);
  });
});

describe('hasRateLimitHeaders', () => {
  it('recognises each standard header name, case-normalised', () => {
    expect(hasRateLimitHeaders({ 'retry-after': '60' })).toBe(true);
    expect(hasRateLimitHeaders({ 'x-ratelimit-limit': '5' })).toBe(true);
    expect(hasRateLimitHeaders({ 'x-rate-limit-limit': '5' })).toBe(true);
    expect(hasRateLimitHeaders({ 'ratelimit-limit': '5' })).toBe(true);
    expect(hasRateLimitHeaders({ 'x-ratelimit-remaining': '0' })).toBe(true);
  });

  it('is false when none of the recognised headers are present', () => {
    expect(hasRateLimitHeaders({ 'content-type': 'application/json' })).toBe(false);
    expect(hasRateLimitHeaders({})).toBe(false);
  });
});
