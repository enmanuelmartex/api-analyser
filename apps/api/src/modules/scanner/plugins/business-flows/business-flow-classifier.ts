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
 * Path terms that mean "this is a login/logout/token-exchange operation" —
 * strong enough that nothing else about the endpoint gets a vote.
 *
 * `login`/`token`/`auth` are absent from `FLOW_TERMS` for the same reason
 * (see the module comment), which stops the *path* from matching one of the
 * flow kinds above. It does not stop the summary or tags from matching one
 * instead: `POST /auth/login` documented as "Login with email and password"
 * used to classify as MESSAGING, because "email" is in `FLOW_TERMS.MESSAGING`
 * and the summary fallback only runs when the path found nothing. A specific
 * signal the API author put in the path must outrank an incidental word in
 * free-text prose — that priority is the entire point of trying signals in
 * order — so this check runs first and exits before summary/tags are ever
 * consulted, rather than merely being one more term nothing happens to match.
 */
const AUTH_EXCLUSION_TERMS = ['login', 'signin', 'logout', 'authenticate', 'oauth'];

function isAuthenticationPath(tokens: string[]): boolean {
  if (tokens.some((token) => AUTH_EXCLUSION_TERMS.includes(token))) return true;
  // "sign-in" tokenises to ["sign", "in"] rather than the single word "signin".
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'sign' && tokens[i + 1] === 'in') return true;
  }
  return false;
}

/**
 * Terms whose entire point is that no session exists yet — a caller creating
 * an account cannot already be signed into it. Used to suppress the
 * "accepts unauthenticated requests" finding for this specific slice of
 * `ACCOUNT`, without touching the rest of that kind (e.g. `password`, which
 * also names an authenticated "change my password" endpoint and must keep
 * being checked for exactly this).
 */
const PUBLIC_BY_DESIGN_ACCOUNT_TERMS = ['register', 'registration', 'signup'];

/** True when `flow` names a step of account creation, never a signed-in action. */
export function isPublicByDesignAccountFlow(flow: BusinessFlowMatch): boolean {
  return flow.kind === 'ACCOUNT' && PUBLIC_BY_DESIGN_ACCOUNT_TERMS.includes(flow.term);
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

  const pathTokens = tokenise(endpoint.path ?? '');
  if (isAuthenticationPath(pathTokens)) return null;

  const fromPath = findTerm(pathTokens);
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
