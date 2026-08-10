/**
 * What a black-box scan can honestly observe about the *third parties the
 * target itself consumes* — the subject of API10:2023.
 *
 * The category is genuinely hard from outside: the traffic in question flows
 * from the target to its own upstreams and never reaches the scanner. What does
 * reach the scanner are three things, and each is a real signal rather than a
 * proxy for one:
 *
 *   1. Upstream URLs the API hands back in its responses. If one is `http://`,
 *      data the service or its clients fetch travels unencrypted and is
 *      attacker-controllable in transit.
 *   2. Upstream failures that arrive verbatim in an error response. A raw
 *      provider error proves the target relays upstream output without
 *      normalising it — the exact trust the category warns about, and it
 *      discloses the integration and its internals along the way.
 *   3. Inbound intake endpoints — webhooks and callbacks — that accept data
 *      from a third party without verifying who sent it. This is the same
 *      misplaced trust, arriving from the other direction.
 *
 * All three are decided here, as pure functions, so they can be tested against
 * fixed payloads instead of a live integration.
 */

import { tokenise } from '../shared/tokenise';

export interface ExternalUrlReference {
  url: string;
  host: string;
  /** True when the reference uses `http://`. */
  insecure: boolean;
  /** Recognised provider behind the host, when there is one. */
  provider: string | null;
}

/**
 * Hosts that are not third parties: the target itself, loopback, and private
 * ranges. A private address in a response is an SSRF or information-disclosure
 * concern and belongs to those checks, not to this one.
 */
function isInternalHost(host: string, targetHost: string): boolean {
  const lower = host.toLowerCase();
  if (lower === targetHost.toLowerCase()) return true;
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === '::1' || lower === '[::1]') return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true;
  return false;
}

/**
 * Recognised SaaS and cloud providers, by host suffix.
 *
 * The list is not exhaustive and is not meant to be — an unrecognised host is
 * still reported as an external upstream, it simply is not named. What the list
 * buys is the ability to say *which* integration leaked in an error, which is
 * the difference between a finding an engineer can act on and one they cannot.
 */
const PROVIDERS: ReadonlyArray<{ suffix: string; name: string }> = [
  { suffix: 'stripe.com', name: 'Stripe' },
  { suffix: 'paypal.com', name: 'PayPal' },
  { suffix: 'braintreegateway.com', name: 'Braintree' },
  { suffix: 'adyen.com', name: 'Adyen' },
  { suffix: 'twilio.com', name: 'Twilio' },
  { suffix: 'sendgrid.net', name: 'SendGrid' },
  { suffix: 'sendgrid.com', name: 'SendGrid' },
  { suffix: 'mailgun.net', name: 'Mailgun' },
  { suffix: 'mailgun.org', name: 'Mailgun' },
  { suffix: 'amazonaws.com', name: 'AWS' },
  { suffix: 'googleapis.com', name: 'Google Cloud' },
  { suffix: 'firebaseio.com', name: 'Firebase' },
  { suffix: 'azure.com', name: 'Azure' },
  { suffix: 'azurewebsites.net', name: 'Azure' },
  { suffix: 'cloudinary.com', name: 'Cloudinary' },
  { suffix: 'slack.com', name: 'Slack' },
  { suffix: 'github.com', name: 'GitHub' },
  { suffix: 'openai.com', name: 'OpenAI' },
  { suffix: 'anthropic.com', name: 'Anthropic' },
  { suffix: 'algolia.net', name: 'Algolia' },
  { suffix: 'auth0.com', name: 'Auth0' },
  { suffix: 'okta.com', name: 'Okta' },
  { suffix: 'shopify.com', name: 'Shopify' },
  { suffix: 'salesforce.com', name: 'Salesforce' },
  { suffix: 'hubapi.com', name: 'HubSpot' },
  { suffix: 'zendesk.com', name: 'Zendesk' },
  { suffix: 'segment.io', name: 'Segment' },
  { suffix: 'mixpanel.com', name: 'Mixpanel' },
  { suffix: 'elastic-cloud.com', name: 'Elastic Cloud' },
];

/** The provider behind a hostname, when it is one this check recognises. */
export function identifyProvider(host: string): string | null {
  const lower = host.toLowerCase();
  return PROVIDERS.find(({ suffix }) => lower === suffix || lower.endsWith(`.${suffix}`))?.name ?? null;
}

/**
 * Absolute URLs in a response body that point somewhere other than the target.
 *
 * Deduplicated by host and scheme so a collection response listing two hundred
 * image URLs produces one reference, not two hundred.
 */
export function extractExternalUrls(
  body: string,
  targetHost: string,
  limit = 10,
): ExternalUrlReference[] {
  const found = new Map<string, ExternalUrlReference>();

  for (const match of body.matchAll(/https?:\/\/[^\s"'`<>\\)\]}]+/gi)) {
    let parsed: URL;
    try {
      parsed = new URL(match[0]);
    } catch {
      continue;
    }

    if (isInternalHost(parsed.hostname, targetHost)) continue;

    const key = `${parsed.protocol}//${parsed.hostname}`;
    if (found.has(key)) continue;

    found.set(key, {
      url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
      host: parsed.hostname,
      insecure: parsed.protocol === 'http:',
      provider: identifyProvider(parsed.hostname),
    });

    if (found.size >= limit) break;
  }

  return [...found.values()];
}

/** Text that only appears when something went wrong inside the service. */
const ERROR_TOKENS = [
  'econnrefused', 'econnreset', 'etimedout', 'enotfound', 'getaddrinfo',
  'socket hang up', 'fetch failed', 'axioserror', 'requesterror',
  'traceback', 'stack trace', 'at async', 'upstream', 'bad gateway',
  'gateway timeout', 'unhandled', 'exception',
];

export interface UpstreamErrorLeak {
  /** Named provider when recognised, otherwise the bare host. */
  provider: string;
  /** The upstream host that appeared in the response. */
  host: string;
  /** The error token that made this an error rather than ordinary content. */
  errorToken: string;
}

/**
 * Detects an upstream failure that reached the client verbatim.
 *
 * Both halves are required. A response mentioning `s3.amazonaws.com` is
 * ordinary; a response mentioning it next to `ECONNREFUSED` is the service
 * relaying its upstream's failure — and with it the integration's identity,
 * often its endpoint path and occasionally a stack frame.
 */
export function detectUpstreamErrorLeak(
  body: string,
  targetHost: string,
): UpstreamErrorLeak | null {
  const lower = body.toLowerCase();
  const errorToken = ERROR_TOKENS.find((token) => lower.includes(token));
  if (!errorToken) return null;

  for (const reference of extractExternalUrls(body, targetHost, 5)) {
    return {
      provider: reference.provider ?? reference.host,
      host: reference.host,
      errorToken,
    };
  }

  // A provider can be named without a full URL — "Stripe API error", say.
  for (const { suffix, name } of PROVIDERS) {
    const bareName = name.toLowerCase();
    if (lower.includes(suffix) || new RegExp(`\\b${bareName}\\b`).test(lower)) {
      return { provider: name, host: suffix, errorToken };
    }
  }

  return null;
}

/**
 * Path and summary vocabulary for an endpoint that *receives* third-party calls.
 *
 * `notification` is deliberately absent: `POST /notifications` is far more often
 * an endpoint that sends one than one that receives a provider callback, and
 * treating outbound messaging as an unverified intake would be wrong in the
 * direction that matters.
 */
const INTAKE_TERMS = ['webhook', 'callback', 'hook', 'ipn', 'postback'];

/**
 * Signature headers a webhook intake should require, lowercased.
 *
 * Any of these declared on the operation means the author thought about
 * verifying the sender, which is enough to suppress the finding — whether the
 * verification is correct is not something a black-box probe can settle.
 */
const SIGNATURE_HEADERS = [
  'x-hub-signature', 'x-hub-signature-256', 'stripe-signature', 'x-signature',
  'x-webhook-signature', 'x-hook-signature', 'signature', 'x-slack-signature',
  'x-shopify-hmac-sha256', 'x-twilio-signature', 'x-amz-sns-message-id',
  'x-github-delivery', 'paypal-transmission-sig', 'x-pagerduty-signature',
];

/** The intake term this endpoint is named with, or `null`. */
export function webhookIntakeTerm(path: string, summary?: string): string | null {
  const fromPath = tokenise(path).find((token) => INTAKE_TERMS.includes(token));
  if (fromPath) return fromPath;

  return tokenise(summary ?? '').find((token) => INTAKE_TERMS.includes(token)) ?? null;
}

/** The signature header the operation declares, or `null`. */
export function declaredSignatureHeader(headerNames: string[]): string | null {
  const lowered = headerNames.map((name) => name.toLowerCase());
  return (
    SIGNATURE_HEADERS.find((header) => lowered.includes(header)) ??
    lowered.find((name) => name.includes('signature') || name.includes('hmac')) ??
    null
  );
}
