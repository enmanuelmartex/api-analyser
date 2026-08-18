import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

/**
 * Shape `@nestjs/throttler`'s `ThrottlerStorage.increment` must return.
 * `ThrottlerStorageRecord` is not re-exported from the package's public entry
 * point, so this is a structural copy rather than an import — TypeScript
 * treats it as the same type regardless.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed counter for `@nestjs/throttler`.
 *
 * The library ships an in-memory `ThrottlerStorageService` by default, which is
 * why the module being *configured* (`ThrottlerModule.forRoot` in app.module.ts)
 * never actually protected anything running behind a load balancer: two API
 * instances each count a client's requests independently, so a client that
 * alternates between them sees double the configured limit. Every API instance
 * already talks to the same Redis (BullMQ's connection), so counting there
 * instead is what makes the limit a property of the *account or IP*, not of
 * whichever process happened to answer this request.
 *
 * The increment-and-maybe-block sequence runs as one Lua script so a burst of
 * concurrent requests — the exact traffic shape a rate limiter exists to catch —
 * cannot race each other into all reading a count from before any of them
 * incremented it.
 */
@Injectable()
export class RedisThrottlerStorageService implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorageService.name);
  private readonly client: Redis;

  /**
   * KEYS[1] = counter key, KEYS[2] = block key.
   * ARGV[1] = ttl ms, ARGV[2] = limit, ARGV[3] = block duration ms.
   *
   * Returns [totalHits, msToExpire, isBlocked (0/1), msToBlockExpire].
   */
  private static readonly INCREMENT_SCRIPT = `
    local blockedTtl = redis.call('PTTL', KEYS[2])
    if blockedTtl and blockedTtl > 0 then
      local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl < 0 then ttl = 0 end
      return {hits, ttl, 1, blockedTtl}
    end

    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('PTTL', KEYS[1])
    if ttl < 0 then ttl = tonumber(ARGV[1]) end

    if hits > tonumber(ARGV[2]) then
      redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
      return {hits, ttl, 1, tonumber(ARGV[3])}
    end

    return {hits, ttl, 0, 0}
  `;

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.get<string>('redis.url'), {
      // A rate limiter that fails open by blocking the request queue on a
      // flaky Redis would turn an infrastructure hiccup into an outage;
      // retryStrategy keeps reconnecting in the background instead.
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
      lazyConnect: false,
    });
    this.client.on('error', (err) => {
      this.logger.warn(`Redis connection error (rate limiting degrades open): ${err.message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${counterKey}:blocked`;

    try {
      const [totalHits, ttlMs, isBlockedRaw, blockTtlMs] = (await this.client.eval(
        RedisThrottlerStorageService.INCREMENT_SCRIPT,
        2,
        counterKey,
        blockKey,
        ttl,
        limit,
        blockDuration || ttl,
      )) as [number, number, number, number];

      return {
        totalHits,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: isBlockedRaw === 1,
        timeToBlockExpire: Math.ceil(blockTtlMs / 1000),
      };
    } catch (err) {
      // Fails OPEN, not closed: a Redis outage must not take the whole API
      // down with it. The trade-off is accepted explicitly rather than left
      // to whatever ioredis happens to throw — see the class comment.
      this.logger.warn(`Rate limit check failed open for "${throttlerName}": ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
