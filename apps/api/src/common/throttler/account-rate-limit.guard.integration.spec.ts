import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { AccountRateLimitGuard } from './account-rate-limit.guard';
import { RedisThrottlerStorageService } from './redis-throttler-storage.service';

const configService = { get: () => process.env.REDIS_URL || 'redis://localhost:6379' } as any;
let storage: RedisThrottlerStorageService;
let guard: AccountRateLimitGuard;

function contextFor(body: Record<string, unknown>): ExecutionContext {
  const responseHeaders: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body }),
      getResponse: () => ({ header: (name: string, value: string) => (responseHeaders[name] = value) }),
    }),
    __responseHeaders: responseHeaders,
  } as any;
}

beforeEach(() => {
  storage = new RedisThrottlerStorageService(configService);
  guard = new AccountRateLimitGuard(storage);
});

afterEach(() => {
  storage.onModuleDestroy();
});

describe('AccountRateLimitGuard', () => {
  it('allows a request with no email through, leaving validation to the DTO', async () => {
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
  });

  it('allows attempts under the per-account limit', async () => {
    const email = `under-limit-${Date.now()}@test.local`;
    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(contextFor({ email }))).resolves.toBe(true);
    }
  });

  it('blocks with a 429 once the per-account limit is exceeded, and sets Retry-After', async () => {
    const email = `over-limit-${Date.now()}@test.local`;
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(contextFor({ email }));
    }

    const context = contextFor({ email });
    let caught: any = null;
    try {
      await guard.canActivate(context);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ThrottlerException);
    expect(caught.getStatus()).toBe(429);
    expect(Number((context as any).__responseHeaders['Retry-After'])).toBeGreaterThan(0);
  });

  it('is case- and whitespace-insensitive, matching login lookup semantics', async () => {
    const base = `Case-Sensitive-${Date.now()}@Test.Local`;
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(contextFor({ email: base }));
    }

    // Same account, different casing/whitespace — must hit the same bucket.
    let caught: any = null;
    try {
      await guard.canActivate(contextFor({ email: `  ${base.toUpperCase()}  ` }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ThrottlerException);
  });

  it('never uses the raw email as the Redis key', async () => {
    const email = `redacted-${Date.now()}@test.local`;
    await guard.canActivate(contextFor({ email }));

    const rawKeyRecord = await storage.increment(email, 60_000, 999, 60_000, 'auth-account');
    const hashedKeyRecord = await storage.increment(
      createHash('sha256').update(email).digest('hex'),
      60_000,
      999,
      60_000,
      'auth-account',
    );

    // The guard's own hit landed on the hashed key's bucket (now at 2 after
    // this test's own probe), never on a bucket keyed by the plaintext email
    // (which starts fresh at 1 here, proving the guard never touched it).
    expect(rawKeyRecord.totalHits).toBe(1);
    expect(hashedKeyRecord.totalHits).toBe(2);
  });
});
