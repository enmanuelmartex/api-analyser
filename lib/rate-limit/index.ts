import type { RelayConfig } from '@/lib/config/env';
import type { Logger } from '@/lib/logging/logger';
import { MemoryRateLimiter } from '@/lib/rate-limit/memory-rate-limiter';
import type { RateLimiter } from '@/lib/rate-limit/rate-limiter';
import { UpstashRateLimiter } from '@/lib/rate-limit/upstash-rate-limiter';

export type { RateLimiter, RateLimitDecision } from '@/lib/rate-limit/rate-limiter';
export { MemoryRateLimiter } from '@/lib/rate-limit/memory-rate-limiter';
export { UpstashRateLimiter } from '@/lib/rate-limit/upstash-rate-limiter';

/**
 * Chooses a limiter from configuration, and complains when the choice is wrong
 * for the environment.
 *
 * Adding a distributed limiter to a deployment is deliberately not a code
 * change: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the
 * Vercel project and the next invocation picks it up.
 *
 * Any other store is one file. Implement `RateLimiter` — three methods' worth
 * of surface — and add a branch here: Vercel KV speaks the same REST protocol
 * as Upstash and can reuse `UpstashRateLimiter` outright; a self-hosted Redis
 * needs a client and a `consume` that runs the same INCR/EXPIRE pair.
 */
export function createRateLimiter(config: RelayConfig, logger: Logger): RateLimiter {
  const { upstashUrl, upstashToken } = config.rateLimit;

  if (upstashUrl && upstashToken) {
    return new UpstashRateLimiter({ url: upstashUrl, token: upstashToken, logger });
  }

  if (process.env.NODE_ENV === 'production') {
    logger.warn('rate_limit.not_distributed', {
      detail:
        'Using the in-memory limiter on serverless: counters are per-instance and reset on cold start. ' +
        'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for a shared limit.',
    });
  }

  return new MemoryRateLimiter();
}
