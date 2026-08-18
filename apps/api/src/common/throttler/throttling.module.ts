import { Module } from '@nestjs/common';
import { RedisThrottlerStorageService } from './redis-throttler-storage.service';
import { AccountRateLimitGuard } from './account-rate-limit.guard';

/**
 * Separate from `ThrottlerModule` itself so `RedisThrottlerStorageService` can
 * be injected into `ThrottlerModule.forRootAsync`'s factory (see app.module.ts)
 * — a dynamic module's factory can only resolve providers from modules listed
 * in its own `imports`, not from whatever imports it — and so any controller
 * that wants the per-account login guard can import this module instead of
 * reconstructing the Redis connection itself.
 */
@Module({
  providers: [RedisThrottlerStorageService, AccountRateLimitGuard],
  exports: [RedisThrottlerStorageService, AccountRateLimitGuard],
})
export class ThrottlingModule {}
