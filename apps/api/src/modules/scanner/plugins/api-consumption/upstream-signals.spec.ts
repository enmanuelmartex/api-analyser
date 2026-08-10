import { describe, expect, it } from 'bun:test';
import {
  declaredSignatureHeader,
  detectUpstreamErrorLeak,
  extractExternalUrls,
  identifyProvider,
  webhookIntakeTerm,
} from './upstream-signals';

const TARGET = 'api.example.com';

describe('extractExternalUrls', () => {
  it('finds third-party references and marks the insecure ones', () => {
    const body = JSON.stringify({
      avatar: 'https://cdn.cloudinary.com/demo/image/upload/a.png',
      feed: 'http://partner-feeds.example.org/v1/items',
    });

    const references = extractExternalUrls(body, TARGET);

    expect(references).toHaveLength(2);
    expect(references.find((r) => r.host === 'cdn.cloudinary.com')!.insecure).toBe(false);
    expect(references.find((r) => r.host === 'partner-feeds.example.org')!.insecure).toBe(true);
  });

  it('ignores the target itself', () => {
    const body = `{"self":"https://${TARGET}/v1/orders/1"}`;

    expect(extractExternalUrls(body, TARGET)).toEqual([]);
  });

  it('ignores loopback and private addresses, which belong to the SSRF check', () => {
    const body = JSON.stringify({
      a: 'http://localhost:8080/internal',
      b: 'http://127.0.0.1/health',
      c: 'http://10.1.2.3/queue',
      d: 'http://192.168.1.10/admin',
      e: 'http://169.254.169.254/latest/meta-data/',
      f: 'http://172.20.0.5/svc',
    });

    expect(extractExternalUrls(body, TARGET)).toEqual([]);
  });

  it('collapses a list of many URLs from one host into one reference', () => {
    // A collection response listing 200 images must produce one finding, not 200.
    const body = Array.from({ length: 200 }, (_, i) => `"http://images.partner.net/${i}.jpg"`).join(',');

    expect(extractExternalUrls(body, TARGET)).toHaveLength(1);
  });

  it('names the provider when the host is one it recognises', () => {
    expect(identifyProvider('api.stripe.com')).toBe('Stripe');
    expect(identifyProvider('bucket.s3.amazonaws.com')).toBe('AWS');
    expect(identifyProvider('api.unknown-vendor.io')).toBeNull();
  });

  it('does not treat a lookalike domain as a provider', () => {
    expect(identifyProvider('stripe.com.evil.net')).toBeNull();
  });
});

describe('detectUpstreamErrorLeak', () => {
  it('requires both an upstream and a failure, not either alone', () => {
    // An ordinary response naming an upstream is not a leak…
    expect(
      detectUpstreamErrorLeak('{"logo":"https://api.stripe.com/logo.png"}', TARGET),
    ).toBeNull();

    // …and a local error with no upstream in it is somebody else's finding.
    expect(detectUpstreamErrorLeak('{"error":"unhandled exception"}', TARGET)).toBeNull();
  });

  it('reports the provider and the token that identified the failure', () => {
    const leak = detectUpstreamErrorLeak(
      '{"message":"connect ECONNREFUSED api.stripe.com:443"}',
      TARGET,
    )!;

    expect(leak.provider).toBe('Stripe');
    expect(leak.errorToken).toBe('econnrefused');
  });

  it('recognises a provider named in prose without a URL', () => {
    const leak = detectUpstreamErrorLeak(
      '{"detail":"Twilio request failed: socket hang up"}',
      TARGET,
    )!;

    expect(leak.provider).toBe('Twilio');
  });

  it('falls back to the bare host for an upstream it does not recognise', () => {
    const leak = detectUpstreamErrorLeak(
      '{"detail":"getaddrinfo ENOTFOUND https://billing.partner.io/v2/charge"}',
      TARGET,
    )!;

    expect(leak.provider).toBe('billing.partner.io');
  });
});

describe('webhook intake detection', () => {
  it('recognises an inbound intake endpoint', () => {
    expect(webhookIntakeTerm('/v1/webhooks/stripe')).toBe('webhook');
    expect(webhookIntakeTerm('/payments/ipn')).toBe('ipn');
    expect(webhookIntakeTerm('/x', 'Receive provider callback')).toBe('callback');
  });

  it('does not mistake outbound messaging for an intake', () => {
    // `POST /notifications` sends a notification far more often than it
    // receives one, and calling it an unverified intake would be wrong in the
    // direction that produces a false HIGH.
    expect(webhookIntakeTerm('/notifications')).toBeNull();
    expect(webhookIntakeTerm('/v1/orders')).toBeNull();
  });
});

describe('declaredSignatureHeader', () => {
  it('recognises the providers\' own signature headers', () => {
    expect(declaredSignatureHeader(['Content-Type', 'Stripe-Signature'])).toBe('stripe-signature');
    expect(declaredSignatureHeader(['X-Hub-Signature-256'])).toBe('x-hub-signature-256');
  });

  it('recognises a house-style signature header it has never seen', () => {
    // Any sender verification at all suppresses the finding: whether it is
    // implemented correctly is not decidable from outside.
    expect(declaredSignatureHeader(['X-Acme-Payload-Hmac'])).toBe('x-acme-payload-hmac');
  });

  it('returns null when nothing verifies the sender', () => {
    expect(declaredSignatureHeader(['Content-Type', 'X-Request-Id'])).toBeNull();
  });
});
