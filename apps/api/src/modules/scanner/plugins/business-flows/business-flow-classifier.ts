/**
 * Decides whether an endpoint is a *sensitive business flow* — the question
 * API6:2023 turns on.
 *
 * This is kept as a pure module, separate from the plugin, because it is the
 * only guessy part of the check: everything else the plugin reports is an
 * observed HTTP response. Classification is naming-based, so it is where a
 * false positive would be born, and it is therefore the part that has to be
 * directly testable without a network.
 *
 * Two rules keep the guessing honest:
 *
 *   1. Matching is on whole tokens, never substrings. `/reports/generate`
 *      contains the letters of "rate", and `/bookmarks` contains "book"; a
 *      substring matcher classifies both as business flows and the check
 *      becomes noise. Paths are split into tokens and compared exactly.
 *   2. A classification alone is never a finding. It only selects which
 *      endpoints are worth probing; the finding is the probe result.
 */

import { tokenise } from '../shared/tokenise';

export type BusinessFlowKind =
  | 'PAYMENT'
  | 'ORDER'
  | 'BOOKING'
  | 'ACCOUNT'
  | 'MESSAGING'
  | 'CONTENT'
  | 'REWARD';

export interface BusinessFlowMatch {
  kind: BusinessFlowKind;
  /** The token that matched, quoted in the finding so a reader can judge it. */
  term: string;
  /** Where it matched, so an operator can see how weak or strong the signal is. */
  matchedIn: 'path' | 'summary' | 'tag';
}

export interface ClassifiableEndpoint {
  path: string;
  method: string;
  summary?: string;
  tags?: string[];
}

/**
 * Only state-changing methods are considered.
 *
 * API6 also covers scraping through read endpoints, but a missing throttle on a
 * GET is already reported by the rate-limit check against API4. Classifying
 * reads here would produce a second finding for the same observation on the
 * same endpoint, which inflates the issue count without telling the user
 * anything new. DELETE is excluded as well: the probe repeats the request, and
 * repeating a delete against a live system is not a defensible thing for a
 * scanner to do on its own initiative.
 */
const PROBED_METHODS = ['POST', 'PUT', 'PATCH'];

/**
 * Flow vocabulary, in singular form — tokens are singularised before matching.
 *
 * Deliberately absent: `login`, `token`, `auth`. Credential stuffing against a
 * login endpoint is real, but it is what the broken-authentication and
 * rate-limit checks already test, and a third report of the same endpoint helps
 * nobody.
 */
const FLOW_TERMS: Record<BusinessFlowKind, readonly string[]> = {
  PAYMENT: [
    'payment', 'pay', 'charge', 'checkout', 'billing', 'invoice', 'transfer',
    'withdraw', 'withdrawal', 'topup', 'refund', 'payout', 'transaction',
    'wallet', 'deposit',
  ],
  ORDER: [
    'order', 'cart', 'purchase', 'buy', 'basket', 'subscription', 'subscribe',
    'upgrade', 'renewal', 'renew',
  ],
  BOOKING: [
    'booking', 'reservation', 'reserve', 'appointment', 'ticket', 'seat', 'slot',
  ],
  REWARD: [
    'coupon', 'promo', 'promotion', 'voucher', 'discount', 'redeem',
    'redemption', 'reward', 'loyalty', 'referral', 'gift', 'claim',
  ],
  MESSAGING: [
    'message', 'sms', 'email', 'mail', 'notification', 'notify', 'broadcast',
    'invite', 'invitation', 'share',
  ],
  ACCOUNT: [
    'register', 'registration', 'signup', 'otp', 'activate', 'activation',
    'enroll', 'enrollment', 'verify', 'verification', 'password', 'resend',
  ],
  CONTENT: ['comment', 'review', 'rating', 'vote', 'post', 'upload', 'follow'],
};

/**
 * Order in which kinds are tried, most business-critical first.
 *
 * `/orders/{id}/payments` matches both ORDER and PAYMENT; reporting it as a
 * payment flow is the more useful of the two, and a stable order keeps the
 * finding — and therefore the issue fingerprint — from flipping between runs.
 */
const KIND_PRIORITY: readonly BusinessFlowKind[] = [
  'PAYMENT', 'ORDER', 'BOOKING', 'REWARD', 'MESSAGING', 'ACCOUNT', 'CONTENT',
];

/**
 * Kinds where automating the flow costs the business money on every repetition
 * — spend, inventory or third-party fees — as opposed to merely producing junk.
 * Used to separate a high-severity finding from a medium one.
 */
const HIGH_IMPACT_KINDS: readonly BusinessFlowKind[] = [
  'PAYMENT', 'ORDER', 'BOOKING', 'REWARD', 'MESSAGING',
];

function findTerm(tokens: string[]): { kind: BusinessFlowKind; term: string } | null {
  const present = new Set(tokens);

  for (const kind of KIND_PRIORITY) {
    for (const term of FLOW_TERMS[kind]) {
      if (present.has(term)) return { kind, term };
    }
  }

  return null;
}

/**
 * Returns the flow this endpoint belongs to, or `null` when nothing in its
 * naming identifies it as business-sensitive.
 *
 * Signals are tried strongest first: the path is chosen by the API author to
 * name the operation, a summary is prose that may mention anything, and a tag
 * is a grouping label shared by unrelated operations.
 */
export function classifyBusinessFlow(
  endpoint: ClassifiableEndpoint,
): BusinessFlowMatch | null {
  if (!PROBED_METHODS.includes(endpoint.method?.toUpperCase())) return null;

  const fromPath = findTerm(tokenise(endpoint.path ?? ''));
  if (fromPath) return { ...fromPath, matchedIn: 'path' };

  const fromSummary = findTerm(tokenise(endpoint.summary ?? ''));
  if (fromSummary) return { ...fromSummary, matchedIn: 'summary' };

  for (const tag of endpoint.tags ?? []) {
    const fromTag = findTerm(tokenise(tag));
    if (fromTag) return { ...fromTag, matchedIn: 'tag' };
  }

  return null;
}

/** True when repeating this kind of flow has a direct cost to the business. */
export function isHighImpactFlow(kind: BusinessFlowKind): boolean {
  return HIGH_IMPACT_KINDS.includes(kind);
}

/** Human label for a flow kind, used in finding titles. */
export function flowKindLabel(kind: BusinessFlowKind): string {
  switch (kind) {
    case 'PAYMENT': return 'payment';
    case 'ORDER': return 'ordering';
    case 'BOOKING': return 'booking';
    case 'REWARD': return 'promotion';
    case 'MESSAGING': return 'messaging';
    case 'ACCOUNT': return 'account';
    case 'CONTENT': return 'content submission';
  }
}
