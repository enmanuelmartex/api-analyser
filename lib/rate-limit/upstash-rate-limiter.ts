import type { Logger } from '@/lib/logging/logger';
import { allow, deny, type RateLimiter, type RateLimitDecision } from '@/lib/rate-limit/rate-limiter';

export interface UpstashRateLimiterOptions {
  readonly url: string;
  readonly token: string;
  readonly logger: Logger;
  /** Guards against a slow store adding latency to every send. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1_500;

/**
 * A fixed-window counter in Upstash Redis, over its REST API.
 *
 * Written against `fetch` rather than `@upstash/redis` on purpose: the whole
 * interaction is two commands, the REST protocol is stable, and adding a
 * dependency to a service whose entire value is "small enough to audit in one
 * sitting" is a poor trade.
 *
 * The pipeline is `INCR key` then `EXPIRE key <window> NX`. Sequencing matters:
 * `INCR` creates the key with no TTL, and `NX` sets one only if the key does
 * not already have one, so the window is anchored to the *first* request in it
 * rather than sliding forward with every hit. Getting this backwards produces a
 * limiter that never resets under sustained load.
 */
export class UpstashRateLimiter implements RateLimiter {
  readonly name = 'upstash-redis';
  readonly distributed = true;

  private readonly url: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(options: UpstashRateLimiterOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const redisKey = `mail-relay:rl:${key}`;

    try {
      const results = await this.pipeline(
        [
          ['INCR', redisKey],
          ['EXPIRE', redisKey, String(windowSeconds), 'NX'],
        ],
        this.timeoutMs,
      );

      const count = Number(results[0]);
      if (!Number.isFinite(count)) {
        throw new Error('unexpected INCR reply');
      }

      if (count > limit) {
        const ttl = await this.ttl(redisKey);
        return deny(limit, ttl > 0 ? ttl : windowSeconds);
      }

      return allow(limit, limit - count);
    } catch (error) {
      // Fail open, and say so loudly.
      //
      // The endpoint behind this limiter already requires a bearer token, so
      // the exposure during a store outage is bounded by who holds it. Failing
      // closed would mean a Redis blip silently stops every report email in
      // every install — a worse outcome than a temporarily uncounted send.
      this.logger.warn('rate_limit.unavailable', {
        limiter: this.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      return allow(limit, limit - 1);
    }
  }

  private async pipeline(commands: string[][], timeoutMs: number): Promise<unknown[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });

    if (!response.ok) {
      // Status only. The body of a failed Redis REST call can echo the command,
      // and the command contains a key derived from a credential.
      throw new Error(`upstash responded ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown; error?: string }[];
    return payload.map((entry) => entry.result);
  }

  private async ttl(redisKey: string): Promise<number> {
    const [result] = await this.pipeline([['TTL', redisKey]], this.timeoutMs);
    const seconds = Number(result);
    return Number.isFinite(seconds) ? seconds : 0;
  }
}
