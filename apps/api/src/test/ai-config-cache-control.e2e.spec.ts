import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { resetTestDatabase, setupTestDatabase, testDatabaseUrl } from './db';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * `GET /api/v1/ai/config` was flagged for a missing `Cache-Control` header —
 * a real finding, since its response carries provider configuration for an
 * admin-only, platform-global resource. The fix is the global `no-store`
 * middleware in main.ts (see no-store.middleware.ts); this proves it reaches
 * this specific route, in both its 200 and its 401 shape, rather than only
 * asserting the middleware's own unit-level logic.
 *
 * Same "dynamic import after DATABASE_URL is repointed" structure as
 * auth-rate-limit.e2e.spec.ts — see the comment there for why that ordering
 * matters (lib/auth.ts constructs a PrismaClient as an import side effect).
 */
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let adminToken: string;

beforeAll(async () => {
  await setupTestDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();

  const [
    { PrismaModule },
    { PrismaService },
    { CryptoModule },
    configurationModule,
    { validateEnv },
    { SettingsModule },
    { AuditModule },
    { AuthModule },
    { AiModule },
    { HttpExceptionFilter },
    { noStoreForApi },
  ] = await Promise.all([
    import('../prisma/prisma.module'),
    import('../prisma/prisma.service'),
    import('../common/crypto/crypto.module'),
    import('../config/configuration'),
    import('../config/env.validation'),
    import('../modules/settings/settings.module'),
    import('../modules/audit/audit.module'),
    import('../modules/auth/auth.module'),
    import('../modules/ai/ai.module'),
    import('../common/filters/http-exception.filter'),
    import('../common/middleware/no-store.middleware'),
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
      CryptoModule,
      PrismaModule,
      SettingsModule,
      AuditModule,
      AuthModule,
      AiModule,
    ],
  })
  class CacheControlTestAppModule {}

  const moduleRef = await Test.createTestingModule({ imports: [CacheControlTestAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(noStoreForApi());
  app.setGlobalPrefix('api/v1');
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);

  const { hash } = await import('bcryptjs');
  const admin = await prisma.user.create({
    data: {
      email: `ai-config-admin-${Date.now()}@test.local`,
      name: 'AI Config Spec Admin',
      password: await hash('Correct-Horse-1!', 4),
      role: 'ADMIN',
    } as any,
  });
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'Correct-Horse-1!' }),
  });
  adminToken = (await loginRes.json()).accessToken;
}, 60_000);

afterAll(async () => {
  if (prisma) await resetTestDatabase(prisma);
  await app?.close();
});

describe('GET /api/v1/ai/config', () => {
  it('returns Cache-Control: no-store on a successful (200) response', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns Cache-Control: no-store even on a 401 (no credentials)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/config`);

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('DELETE /api/v1/ai/config', () => {
  it('does not exist as a bare route — only DELETE /ai/config/:provider does — and 404s rather than deleting anything', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/config`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });
});
