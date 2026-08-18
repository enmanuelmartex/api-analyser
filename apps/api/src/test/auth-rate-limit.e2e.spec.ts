import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { resetTestDatabase, setupTestDatabase, testDatabaseUrl } from './db';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * End-to-end proof that `/api/v1/auth/login` and `/api/v1/auth/register`
 * actually return 429 under rapid requests — the concrete gap the scanner
 * found (`@nestjs/throttler` was configured but no guard ever applied it) and
 * the concrete fix (`APP_GUARD` + Redis-backed storage + per-route
 * `@Throttle()` overrides, see app.module.ts and auth.controller.ts).
 *
 * Boots a real Nest application containing `AuthModule` and the same
 * `APP_GUARD`/`ThrottlerModule` wiring `AppModule` uses, rather than
 * `AppModule` itself: `AppModule` also pulls in the AI, reports, scanner and
 * email modules, none of which this suite exercises, and none of which are
 * risk-free to bootstrap inside a test process. This module is not a
 * duplicate of the real wiring so much as the same wiring with the unrelated
 * modules left out — same guard, same storage, same controller.
 *
 * Every app-local module is imported dynamically, inside `beforeAll`, AFTER
 * `DATABASE_URL` is repointed at the test database. `lib/auth.ts` — pulled in
 * transitively through `AuthModule` — constructs its own `PrismaClient` as a
 * side effect of being imported, not lazily on first use, so a static
 * top-of-file import would have captured whatever `DATABASE_URL` the process
 * started with, and every Better Auth credential write in this suite would
 * have landed in the real development database instead of the disposable one
 * `setupTestDatabase()` creates.
 */
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;

beforeAll(async () => {
  // Runs against the isolated integration test database, never the real
  // development one — this suite fires a burst of real requests at a real
  // bootstrapped app, which would otherwise write dozens of throwaway user
  // rows into whatever `DATABASE_URL` normally points at.
  await setupTestDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();

  // The IP-based throttle buckets this suite deliberately trips live in the
  // real, shared Redis (rate limiting only means something when it survives a
  // process restart) with a TTL as long as five minutes — so a suite re-run
  // inside that window would inherit the previous run's count instead of
  // starting clean. Scoped to this app's own `throttle:` prefix, never a
  // blanket FLUSHDB, since the dev stack's BullMQ queues share this Redis.
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const keys = await redis.keys('throttle:*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();

  const [
    { PrismaModule },
    { PrismaService },
    configurationModule,
    { validateEnv },
    { SettingsModule },
    { AuditModule },
    { AuthModule },
    { ThrottlingModule },
    { RedisThrottlerStorageService },
  ] = await Promise.all([
    import('../prisma/prisma.module'),
    import('../prisma/prisma.service'),
    import('../config/configuration'),
    import('../config/env.validation'),
    import('../modules/settings/settings.module'),
    import('../modules/audit/audit.module'),
    import('../modules/auth/auth.module'),
    import('../common/throttler/throttling.module'),
    import('../common/throttler/redis-throttler-storage.service'),
  ]);
  const configuration = configurationModule.default;

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [configuration],
        envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
        validate: validateEnv,
      }),
      EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20 }),
      BullModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({ connection: { url: config.get<string>('redis.url') } }),
      }),
      ThrottlingModule,
      ThrottlerModule.forRootAsync({
        imports: [ThrottlingModule],
        inject: [RedisThrottlerStorageService],
        useFactory: (storage: InstanceType<typeof RedisThrottlerStorageService>) => ({
          storage,
          throttlers: [
            { name: 'short', ttl: 1000, limit: 20 },
            { name: 'medium', ttl: 10000, limit: 100 },
            { name: 'long', ttl: 60000, limit: 500 },
          ],
        }),
      }),
      PrismaModule,
      SettingsModule,
      AuditModule,
      AuthModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
  class RateLimitTestAppModule {}

  const { HttpExceptionFilter } = await import('../common/filters/http-exception.filter');

  const moduleRef = await Test.createTestingModule({ imports: [RateLimitTestAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }),
  );
  // Same filter main.ts installs — in particular, the Retry-After
  // normalization this suite is verifying (`@nestjs/throttler` names it
  // `Retry-After-short`, not `Retry-After`, for any throttler not literally
  // called "default") lives there, not in the guard.
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);
}, 60_000);

afterAll(async () => {
  if (prisma) await resetTestDatabase(prisma);
  await app?.close();
});

function login(email: string, password = 'wrong-password') {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

function register(email: string) {
  return fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Sixteen-Ch4rs!!!', name: 'Rate Limit Spec' }),
  });
}

describe('POST /api/v1/auth/login rate limiting', () => {
  it('is public — a valid login needs no prior session or Authorization header', async () => {
    const email = `e2e-public-login-${Date.now()}@test.local`;
    const password = 'Correct-Horse-1!';
    const { hash } = await import('bcryptjs');
    await prisma.user.create({
      data: {
        email,
        name: 'Public Login Spec',
        password: await hash(password, 4),
        role: 'ANALYST',
      } as any,
    });

    const res = await login(email, password);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
  });

  it('returns 429 with Retry-After once the per-IP limit is exceeded', async () => {
    const email = `e2e-brute-force-${Date.now()}@test.local`;

    const responses = [];
    for (let i = 0; i < 8; i++) {
      responses.push(await login(email));
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);

    const throttled = responses.find((r) => r.status === 429)!;
    expect(throttled.headers.get('retry-after')).toBeTruthy();
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 20_000);
});

describe('POST /api/v1/auth/register rate limiting', () => {
  it('is public — registering a new account needs no prior session', async () => {
    const res = await register(`e2e-public-register-${Date.now()}@test.local`);
    expect(res.status).toBe(201);
  });

  it('returns 429 once the per-IP registration limit is exceeded', async () => {
    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(await register(`e2e-bulk-register-${Date.now()}-${i}@test.local`));
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);
  }, 20_000);
});
