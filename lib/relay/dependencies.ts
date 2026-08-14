import { createAuthenticator, type Authenticator } from '@/lib/auth';
import { ConfigurationError, loadConfig, type RelayConfig } from '@/lib/config/env';
import { createLogger, type Logger } from '@/lib/logging/logger';
import { createRateLimiter, type RateLimiter } from '@/lib/rate-limit';
import type { Mailer } from '@/lib/resend/mailer';
import { createResendMailer } from '@/lib/resend/resend-mailer';

/**
 * Everything the handler needs that it should not construct itself.
 *
 * This is the whole reason the tests can assert "a valid request reaches the
 * mail service with these exact arguments" without a network, an API key, or a
 * mocked module: they build this object with a fake `Mailer`.
 */
export interface RelayDependencies {
  readonly config: RelayConfig;
  readonly authenticator: Authenticator;
  readonly mailer: Mailer;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
}

let cached: RelayDependencies | null = null;

/**
 * Builds the real dependencies, once per warm instance.
 *
 * Memoised because a serverless instance serves many requests and there is no
 * reason to re-read the environment, re-create a Resend client or re-emit the
 * limiter warning for each of them. A cold start builds them again, which is
 * also when a changed environment variable takes effect.
 *
 * @throws {ConfigurationError} when a required variable is unset. Deliberately
 * at first use rather than at import: a module-scope throw turns a missing
 * variable into a build failure with a stack trace, while this turns it into a
 * clean 500 and a log line naming the variable.
 */
export function getRelayDependencies(): RelayDependencies {
  if (cached) return cached;

  const config = loadConfig();
  const logger = createLogger();

  cached = {
    config,
    logger,
    authenticator: createAuthenticator(config),
    mailer: createResendMailer(config.resendApiKey),
    rateLimiter: createRateLimiter(config, logger),
  };

  return cached;
}

/** Test seam. Not used in production code paths. */
export function resetRelayDependencies(): void {
  cached = null;
}

export { ConfigurationError };
