import type { Authenticator } from '@/lib/auth/authenticator';
import { SharedSecretAuthenticator } from '@/lib/auth/shared-secret';
import type { RelayConfig } from '@/lib/config/env';

export type { AuthContext, AuthResult, Authenticator } from '@/lib/auth/authenticator';
export { SharedSecretAuthenticator, SHARED_SECRET_CLIENT_ID } from '@/lib/auth/shared-secret';
export { readBearerToken, secureCompare } from '@/lib/auth/bearer';

/**
 * The single place that decides how callers are identified.
 *
 * Everything downstream depends on the `Authenticator` interface, so growing
 * past one shared secret is a change to this function and one new file:
 *
 *   - **Per-install tokens.** Add `InstallationKeyAuthenticator`, backed by a
 *     table of `{ installationId, tokenHash, revokedAt, rateLimit }`. Look the
 *     token up by its SHA-256, reject when `revokedAt` is set, and return the
 *     installation id as `clientId`. The rate limiter then keys on it with no
 *     further change, and `AuthContext.rateLimit` carries a per-plan override.
 *
 *   - **Both at once, during a migration.** Wrap them in a `ChainAuthenticator`
 *     that tries each in turn and reports which one accepted via `scheme`, so
 *     the logs show how many callers are still on the legacy secret before it
 *     is removed.
 *
 * The route handler never learns which of these is in play.
 */
export function createAuthenticator(config: RelayConfig): Authenticator {
  return new SharedSecretAuthenticator(config.relaySecret);
}
