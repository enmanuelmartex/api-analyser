import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { RedisThrottlerStorageService } from './redis-throttler-storage.service';

/**
 * Per-account brute-force / credential-stuffing guard for login.
 *
 * `@nestjs/throttler`'s own `ThrottlerGuard` — bound globally in
 * `AppModule` and tightened per-route with `@Throttle()` — limits by IP. That
 * stops one machine hammering `/auth/login`, but not credential stuffing
 * distributed across a proxy pool: hundreds of IPs, each staying under the
 * per-IP limit, all trying the same stolen `email`/password list against one
 * account. This closes that gap with a second, independent counter keyed by
 * the *account* being attacked rather than the caller's address, so it
 * catches the attack pattern the IP limit cannot see.
 *
 * The two limits are deliberately different mechanisms rather than two
 * `@Throttle()` entries on one guard: `@nestjs/throttler`'s tracker function
 * has no standard way to combine "one bucket per IP" and "one bucket per
 * request body field" as independent, both-must-pass checks on the same
 * route without a second full guard anyway, and a second guard makes the two
 * limits (and their very different reasoning) visible as two separate things
 * in the controller rather than one generic-looking decorator.
 *
 * The email is never stored or logged in the clear — only its SHA-256 keys
 * the Redis counter — and a request with no email in the body is let through
 * for `LoginDto`'s own validation to reject, rather than this guard trying to
 * explain a shape it does not own.
 */
@Injectable()
export class AccountRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AccountRateLimitGuard.name);

  /** 10 attempts per account per minute — looser than the 5/min per-IP limit
   *  on purpose, since a shared IP (office NAT, campus network) legitimately
   *  produces more login attempts against a mix of *different* accounts than
   *  one account should ever see attempts against in the same window. */
  private static readonly LIMIT = 10;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly storage: RedisThrottlerStorageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : null;
    if (!email) return true;

    const key = createHash('sha256').update(email).digest('hex');
    const record = await this.storage.increment(
      key,
      AccountRateLimitGuard.TTL_MS,
      AccountRateLimitGuard.LIMIT,
      AccountRateLimitGuard.TTL_MS,
      'auth-account',
    );

    if (record.isBlocked) {
      const response = context.switchToHttp().getResponse();
      response.header('Retry-After', String(record.timeToBlockExpire));
      this.logger.warn(
        `Login rate limit exceeded for one account (${record.totalHits} attempts in the current window)`,
      );
      throw new ThrottlerException('Too many login attempts for this account. Try again later.');
    }

    return true;
  }
}
