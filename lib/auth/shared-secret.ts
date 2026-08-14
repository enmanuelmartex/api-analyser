import {
  authFailure,
  authSuccess,
  type AuthResult,
  type Authenticator,
} from '@/lib/auth/authenticator';
import { readBearerToken, secureCompare } from '@/lib/auth/bearer';

/**
 * Identifier reported for anyone holding the deployment-wide secret.
 *
 * A constant, not a fingerprint of the token. A hash prefix would be a nicer
 * log field, but publishing any function of a secret invites offline guessing
 * if the secret turns out to be weak, and the field buys nothing while there is
 * exactly one credential.
 */
export const SHARED_SECRET_CLIENT_ID = 'shared-secret';

/**
 * One deployment-wide bearer token, compared in constant time.
 *
 * This is the simple implementation, and it is the right one while a single
 * operator runs a single install. Its limits are worth naming: the token cannot
 * be revoked without redeploying, every install that has it is indistinguishable
 * in the logs, and the rate limit it produces is global. Each of those is fixed
 * by replacing this class, not by editing the route — see `lib/auth/index.ts`.
 */
export class SharedSecretAuthenticator implements Authenticator {
  readonly scheme = 'bearer-shared-secret';

  constructor(private readonly secret: string) {
    if (!secret) {
      // Refusing to construct is what stops "unset secret" from quietly
      // meaning "no authentication", i.e. an open mail relay.
      throw new Error('SharedSecretAuthenticator requires a non-empty secret');
    }
  }

  authenticate(request: Request): AuthResult {
    const token = readBearerToken(request);
    if (token === null) {
      return authFailure('missing or malformed Authorization header');
    }

    if (!secureCompare(token, this.secret)) {
      return authFailure('bearer token did not match');
    }

    return authSuccess({ clientId: SHARED_SECRET_CLIENT_ID, scheme: this.scheme });
  }
}
