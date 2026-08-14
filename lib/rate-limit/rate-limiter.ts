export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the caller may retry. Only meaningful when denied. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** For logs and for the startup warning about non-distributed limiters. */
  readonly name: string;
  /** Whether this limiter's counters are shared across instances. */
  readonly distributed: boolean;
  /**
   * Records one hit against `key` and says whether it is allowed.
   *
   * Never throws. A limiter that fails a request because its backing store
   * blinked has converted an availability problem into a delivery failure, and
   * the endpoint behind it is already authenticated.
   */
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}

export const allow = (limit: number, remaining: number): RateLimitDecision => ({
  allowed: true,
  limit,
  remaining: Math.max(remaining, 0),
  retryAfterSeconds: 0,
});

export const deny = (limit: number, retryAfterSeconds: number): RateLimitDecision => ({
  allowed: false,
  limit,
  remaining: 0,
  retryAfterSeconds: Math.max(retryAfterSeconds, 1),
});
