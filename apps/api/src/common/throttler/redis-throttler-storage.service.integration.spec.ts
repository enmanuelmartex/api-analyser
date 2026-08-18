import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorageService } from './redis-throttler-storage.service';

/**
 * Runs against the real dockerized Redis (`REDIS_URL`) rather than a mock —
 * the whole point of this class is the atomicity of its Lua script under
 * concurrent hits, which an in-memory fake cannot exercise honestly.
 */

const configService = { get: () => process.env.REDIS_URL || 'redis://localhost:6379' } as any;
let service: RedisThrottlerStorageService;
let throttlerName: string;

beforeEach(() => {
  service = new RedisThrottlerStorageService(configService);
  // A fresh bucket name per test avoids any cross-test key collision without
  // needing to FLUSHDB a shared Redis instance other things may be using.
  throttlerName = `spec-${randomUUID()}`;
});

afterAll(async () => {
  // Nothing to disconnect at the suite level — each service instance below
  // disconnects itself; see the last test.
});

describe('RedisThrottlerStorageService.increment', () => {
  it('counts hits and stays unblocked under the limit', async () => {
    const key = 'user-a';
    const first = await service.increment(key, 60_000, 5, 60_000, throttlerName);
    const second = await service.increment(key, 60_000, 5, 60_000, throttlerName);

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);
    service.onModuleDestroy();
  });

  it('blocks once the limit is exceeded and reports a positive Retry-After window', async () => {
    const key = 'user-b';
    let last;
    for (let i = 0; i < 6; i++) {
      last = await service.increment(key, 60_000, 5, 30_000, throttlerName);
    }

    expect(last!.totalHits).toBe(6);
    expect(last!.isBlocked).toBe(true);
    expect(last!.timeToBlockExpire).toBeGreaterThan(0);
    expect(last!.timeToBlockExpire).toBeLessThanOrEqual(30);
    service.onModuleDestroy();
  });

  it('keeps a request blocked (without adding to the count) while inside the block window', async () => {
    const key = 'user-c';
    for (let i = 0; i < 6; i++) {
      await service.increment(key, 60_000, 5, 30_000, throttlerName);
    }
    const blockedAttempt = await service.increment(key, 60_000, 5, 30_000, throttlerName);

    expect(blockedAttempt.isBlocked).toBe(true);
    // Still 6 — the blocked branch reports the existing count rather than
    // incrementing further, so a caller hammering a blocked account does not
    // inflate the number reported back to it.
    expect(blockedAttempt.totalHits).toBe(6);
    service.onModuleDestroy();
  });

  it('keeps independent counters for different keys under the same throttler name', async () => {
    const a = await service.increment('isolated-a', 60_000, 5, 60_000, throttlerName);
    const b = await service.increment('isolated-b', 60_000, 5, 60_000, throttlerName);

    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(1);
    service.onModuleDestroy();
  });

  it('survives concurrent hits without losing a count to a race', async () => {
    const key = 'concurrent';
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.increment(key, 60_000, 100, 60_000, throttlerName)),
    );

    const hitCounts = results.map((r) => r.totalHits).sort((a, b) => a - b);
    // Ten concurrent increments against one key must produce ten distinct
    // sequential counts (1..10) — a race in the Lua script would collapse two
    // of them onto the same number.
    expect(hitCounts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    service.onModuleDestroy();
  });

  it('fails open (never blocks) when Redis is unreachable', async () => {
    const brokenConfig = { get: () => 'redis://127.0.0.1:1' } as any; // nothing listens here
    const broken = new RedisThrottlerStorageService(brokenConfig);

    const record = await broken.increment('any-key', 60_000, 1, 60_000, throttlerName);

    expect(record.isBlocked).toBe(false);
    broken.onModuleDestroy();
  });
});
