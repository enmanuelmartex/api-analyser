/**
 * How to read a status code when the question is "did the request get through".
 *
 * Several checks need to distinguish three outcomes that a naive `status < 400`
 * test collapses into one wrong answer:
 *
 *   processed      the request reached application logic. A 400 or a 422 counts:
 *                  the payload was rejected by validation, which means nothing
 *                  in front of the application stopped the call.
 *   challenged     authentication or authorization refused the call before the
 *                  application saw it, or a throttle did.
 *   absent         there is nothing at this route to talk to.
 *
 * The distinction is load-bearing. A burst of requests that all return 401 says
 * the endpoint requires auth — it says *nothing* about whether the flow behind
 * it is throttled, and reporting "no anti-automation controls" off the back of
 * it would be a fabricated finding.
 */

export type RequestOutcome = 'processed' | 'challenged' | 'absent' | 'error';

/** Auth, authorization and throttling refusals — the request never landed. */
const CHALLENGE_STATUSES = [401, 403, 407, 429];

/** Nothing is served here, or not by this method. */
const ABSENT_STATUSES = [404, 405, 410, 501];

/**
 * Statuses that prove the application processed the request.
 *
 * 5xx is excluded even though it proves the request landed: a server error is
 * ambiguous evidence — it may be a WAF, a crash, or the flow half-executing —
 * and no check here should build a claim on it.
 */
export function classifyOutcome(status: number): RequestOutcome {
  if (!status || status <= 0) return 'error';
  if (CHALLENGE_STATUSES.includes(status)) return 'challenged';
  if (ABSENT_STATUSES.includes(status)) return 'absent';
  if (status >= 500) return 'error';
  return 'processed';
}

/** True when the application itself handled the request. */
export function wasProcessed(status: number): boolean {
  return classifyOutcome(status) === 'processed';
}

/** True when auth, authorization or a throttle rejected the request. */
export function wasChallenged(status: number): boolean {
  return classifyOutcome(status) === 'challenged';
}
