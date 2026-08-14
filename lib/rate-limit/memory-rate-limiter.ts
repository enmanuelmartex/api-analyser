import { allow, deny, type RateLimiter, type RateLimitDecision } from '@/lib/rate-limit/rate-limiter';

interface Window {
  count: number;
  /** Epoch ms at which the window rolls over. */
  resetAt: number;
}

/**
 * A fixed-window counter in process memory.
 *
 * **Not a production mechanism on serverless, and it does not pretend to be.**
 * Vercel runs as many concurrent instances as it likes, each with its own heap,
 * so the real ceiling is `limit × instances` and a cold start resets the count
 * to zero. It is honest about that through `distributed: false`, which the
 * factory reads to warn at startup.
 *
 * It is still worth having. Locally it is the whole limiter and needs no Redis;
 * in production it is a floor that stops one runaway loop on one instance from
 * emptying a Resend quota, which is strictly better than no limit at all while
 * Upstash is unconfigured.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly name = 'memory';
  readonly distributed = false;

  private readonly windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const now = this.now();
    this.evictExpired(now);

    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return allow(limit, limit - 1);
    }

    existing.count += 1;

    if (existing.count > limit) {
      return deny(limit, Math.ceil((existing.resetAt - now) / 1000));
    }

    return allow(limit, limit - existing.count);
  }

  /**
   * Keeps the map from growing without bound across a long-lived instance.
   * Cheap because the key space is the number of credentials, not requests.
   */
  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
