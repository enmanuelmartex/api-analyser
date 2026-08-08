import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { appBrand } from './brand/brand';

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
  const authCorsOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.use((req: any, res: any, next: any) => {
    if (!req.originalUrl?.startsWith('/api/auth')) return next();

    // Handle CORS for all /api/auth/* routes (Better Auth doesn't respond to OPTIONS)
    res.setHeader('Access-Control-Allow-Origin', authCorsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cookie,Set-Cookie');

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
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  const nodeEnv     = configService.get<string>('NODE_ENV', 'development');

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // ── CORS for NestJS routes ────────────────────────────────────────────────────
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

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
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── Swagger (non-production) ──────────────────────────────────────────────────
  if (nodeEnv !== 'production') {
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
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    });
  }

  await app.listen(port);

  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║                                                      ║
  ║   ${`${appBrand.name} — ${appBrand.tagline}`.padEnd(51)}║
  ║   Version 0.2.0                                      ║
  ║                                                      ║
  ║   API:  http://localhost:${port}/api/v1                ║
  ║   Auth: http://localhost:${port}/api/auth              ║
  ║   Docs: http://localhost:${port}/api/docs              ║
  ║   Env:  ${nodeEnv.padEnd(42)}║
  ║                                                      ║
  ╚══════════════════════════════════════════════════════╝
  `);
}

bootstrap();
