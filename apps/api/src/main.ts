import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import helmet from 'helmet';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { appBrand } from './brand/brand';
import { getAllowedOrigins, isOriginAllowed } from './config/cors.util';
import { noStoreForApi } from './common/middleware/no-store.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    bufferLogs: true,
    // Disable global body parser — we apply it manually below so that Better Auth
    // can handle its own /api/auth routes without a pre-parsed body.
    bodyParser: false,
  });

  // ── Better Auth ──────────────────────────────────────────────────────────────
  // Mounted FIRST so it intercepts /api/auth/* before NestJS routing.
  const betterAuthHandler = toNodeHandler(auth);
  const allowedOrigins = getAllowedOrigins();
  app.use((req: any, res: any, next: any) => {
    if (!req.originalUrl?.startsWith('/api/auth')) return next();

    // Handle CORS for all /api/auth/* routes (Better Auth doesn't respond to OPTIONS).
    //
    // The origin is only ever echoed back when it is on the allowlist — never
    // reflected unconditionally. `Access-Control-Allow-Origin` cannot carry more
    // than one value, so an allowlisted origin is echoed rather than a static
    // default returned, which is what lets more than one trusted frontend
    // (see CORS_ALLOWED_ORIGINS) share this API with credentials enabled. A
    // request from an origin not on the list gets no CORS headers at all: the
    // browser enforces the block, and the request never reaches this API's own
    // auth/authorization checks regardless.
    const requestOrigin = req.headers.origin as string | undefined;
    if (isOriginAllowed(requestOrigin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin!);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cookie,Set-Cookie');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    req.url = req.originalUrl;
    return betterAuthHandler(req, res);
  });

  // ── Body parser for NestJS routes (/api/v1/*) ────────────────────────────────
  const jsonParser       = express.json({ limit: '10mb' });
  const urlencodedParser = express.urlencoded({ extended: true });
  app.use((req: any, res: any, next: any) => {
    if (req.originalUrl?.startsWith('/api/auth')) return next();
    jsonParser(req, res, (err: any) => {
      if (err) return next(err);
      urlencodedParser(req, res, next);
    });
  });

  // ── Security headers ─────────────────────────────────────────────────────────
  const configService = app.get(ConfigService);
  const port        = configService.get<number>('PORT', 4000);
  const nodeEnv     = configService.get<string>('NODE_ENV', 'development');

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // ── CORS for NestJS routes ────────────────────────────────────────────────────
  //
  // `origin` is a validator, not a string or `*`, specifically so an arbitrary
  // site cannot obtain CORS access by sending any `Origin` header it likes: the
  // `cors` package calls back with `true` only for an origin on the allowlist
  // (`CORS_ALLOWED_ORIGINS`, falling back to `FRONTEND_URL`) and `false`
  // otherwise, which omits `Access-Control-Allow-Origin` from the response
  // rather than echoing the request's origin back unconditionally.
  //
  // `!origin` (no Origin header at all) is allowed through: that is a
  // server-to-server call, a health check, or curl/Postman, none of which are
  // subject to the browser same-origin policy CORS exists to relax in the
  // first place, and none of which can be a cross-site browser attack.
  //
  // Every method here is genuinely used somewhere in this API (DELETE by
  // project/report/AI-provider-config removal, PATCH/PUT by the various
  // updates) — CORS is not the place to restrict a method a route doesn't
  // implement; a route that doesn't implement it already 404s regardless of
  // what a preflight for a *different* route advertises. Authentication and
  // ownership checks, not CORS, are what actually gate a destructive request.
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || isOriginAllowed(requestOrigin, allowedOrigins)) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // ── Cache-Control for the API surface ────────────────────────────────────────
  // Every /api/v1 response, success or error (401/403/429 included) — see
  // no-store.middleware.ts for why this has to be middleware, not an interceptor.
  app.use(noStoreForApi());

  // ── Global prefix ─────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── API Versioning ────────────────────────────────────────────────────────────
  app.enableVersioning({ type: VersioningType.URI });

  // ── Global pipes ──────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global filters & interceptors ─────────────────────────────────────────────
  // The bus is handed in so failed requests become recorded events rather than
  // stdout-only lines. Resolved from the container instead of registering the
  // filter as an APP_FILTER provider, which would change the order it runs in
  // relative to the pipes above.
  app.useGlobalFilters(new HttpExceptionFilter(app.get(EventEmitter2)));
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── Swagger ───────────────────────────────────────────────────────────────────
  // Gated by SWAGGER_ENABLED, not by NODE_ENV — see `docs` in configuration.ts.
  const docsEnabled = configService.get<boolean>('docs.enabled');

  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(`${appBrand.name} API`)
      .setDescription(
        `**${appBrand.name}** — ${appBrand.description}\n\n` +
        'Better Auth endpoints are at `/api/auth/*` (not under `/api/v1`). ' +
        'All domain routes require a `Bearer` JWT obtained via `POST /api/v1/auth/exchange-session`.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'ApiKey')
      .addTag('Auth', 'Authentication and authorization')
      .addTag('Projects', 'Project management')
      .addTag('Assessments', 'Security assessment management')
      .addTag('Findings', 'Vulnerability findings')
      .addTag('Reports', 'Report generation and download')
      .addTag('Users', 'User management')
      .addTag('AI', 'AI provider configuration and usage — admin-only except GET /ai/status')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    // Both document URLs are named explicitly. `<path>-json` is only a default
    // of the current @nestjs/swagger, and these two addresses are what the
    // README, the banner below and any generated client point at.
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      yamlDocumentUrl: 'api/docs-yaml',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    });
  }

  await app.listen(port);

  const docsLine = docsEnabled
    ? `Docs: http://localhost:${port}/api/docs`
    : 'Docs: off (SWAGGER_ENABLED=false)';

  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║                                                      ║
  ║   ${`${appBrand.name} — ${appBrand.tagline}`.padEnd(51)}║
  ║   Version 0.2.0                                      ║
  ║                                                      ║
  ║   ${`API:  http://localhost:${port}/api/v1`.padEnd(51)}║
  ║   ${`Auth: http://localhost:${port}/api/auth`.padEnd(51)}║
  ║   ${docsLine.padEnd(51)}║
  ║   ${`Env:  ${nodeEnv}`.padEnd(51)}║
  ║                                                      ║
  ╚══════════════════════════════════════════════════════╝
  `);
}

bootstrap();
