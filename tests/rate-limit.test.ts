import { describe, expect, test } from 'bun:test';
import { MemoryRateLimiter } from '@/lib/rate-limit/memory-rate-limiter';

describe('MemoryRateLimiter', () => {
  test('allows requests up to the limit and denies the next one', async () => {
    const limiter = new MemoryRateLimiter();

    for (let i = 0; i < 3; i += 1) {
      const decision = await limiter.consume('client', 3, 60);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(2 - i);
    }

    const denied = await limiter.consume('client', 3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('counts each key separately', async () => {
    const limiter = new MemoryRateLimiter();

    await limiter.consume('install-a', 1, 60);
    const other = await limiter.consume('install-b', 1, 60);

    // The property per-install tokens will rely on: swapping the shared secret
    // for per-install credentials turns the global limit into a per-install one
    // with no change here.
    expect(other.allowed).toBe(true);
  });

  test('resets once the window has passed', async () => {
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(() => now);

    await limiter.consume('client', 1, 60);
    expect((await limiter.consume('client', 1, 60)).allowed).toBe(false);

    now += 61_000;
    expect((await limiter.consume('client', 1, 60)).allowed).toBe(true);
  });

  test('reports itself as not distributed', () => {
    // Read by the factory to warn when it is used in production.
    expect(new MemoryRateLimiter().distributed).toBe(false);
  });
});
