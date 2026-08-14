/**
 * The seam between "who is calling" and "what the relay does for them".
 *
 * Today there is one shared secret and one caller. The interface is written for
 * the version after that — per-install tokens, revocation, per-install limits —
 * because those change *which* `Authenticator` is constructed, and nothing
 * else. The route, the validation and the Resend call never learn how a caller
 * was identified.
 */

export interface AuthContext {
  /**
   * Stable identifier for the authenticated caller, safe to write to a log and
   * safe to use as a rate-limit key.
   *
   * With a single shared secret this is a constant, so the limiter is
   * effectively global. When per-install credentials land, this becomes the
   * installation id and the same limiter silently becomes per-install — that is
   * the whole reason the key is carried here rather than derived at the route.
   */
  readonly clientId: string;

  /** Which scheme accepted the request. Recorded for audit. */
  readonly scheme: string;

  /**
   * Per-caller overrides, once credentials carry their own limits. Unset means
   * "use the deployment default".
   */
  readonly rateLimit?: { readonly max: number; readonly windowSeconds: number };
}

export type AuthResult =
  | { readonly ok: true; readonly context: AuthContext }
  /**
   * `reason` is for the server log only. It is never returned to the caller:
   * telling a prober whether the header was missing or merely wrong hands them
   * a free bit of information per request.
   */
  | { readonly ok: false; readonly reason: string };

export interface Authenticator {
  /** Name of the scheme, for logs and for `WWW-Authenticate`. */
  readonly scheme: string;
  authenticate(request: Request): Promise<AuthResult> | AuthResult;
}

export const authFailure = (reason: string): AuthResult => ({ ok: false, reason });
export const authSuccess = (context: AuthContext): AuthResult => ({ ok: true, context });
