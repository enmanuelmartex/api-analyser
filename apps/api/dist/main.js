"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const config_1 = require("@nestjs/config");
const helmet_1 = require("helmet");
const express = require("express");
const node_1 = require("better-auth/node");
const auth_1 = require("./lib/auth");
const app_module_1 = require("./app.module");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
const logging_interceptor_1 = require("./common/interceptors/logging.interceptor");
const brand_1 = require("./brand/brand");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: ['log', 'error', 'warn', 'debug'],
        bufferLogs: true,
        bodyParser: false,
    });
    const betterAuthHandler = (0, node_1.toNodeHandler)(auth_1.auth);
    const authCorsOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    app.use((req, res, next) => {
        if (!req.originalUrl?.startsWith('/api/auth'))
            return next();
        res.setHeader('Access-Control-Allow-Origin', authCorsOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cookie,Set-Cookie');
        if (req.method === 'OPTIONS')
            return res.sendStatus(204);
        req.url = req.originalUrl;
        return betterAuthHandler(req, res);
    });
    const jsonParser = express.json({ limit: '10mb' });
    const urlencodedParser = express.urlencoded({ extended: true });
    app.use((req, res, next) => {
        if (req.originalUrl?.startsWith('/api/auth'))
            return next();
        jsonParser(req, res, (err) => {
            if (err)
                return next(err);
            urlencodedParser(req, res, next);
        });
    });
    const configService = app.get(config_1.ConfigService);
    const port = configService.get('PORT', 4000);
    const frontendUrl = configService.get('FRONTEND_URL', 'http://localhost:3000');
    const nodeEnv = configService.get('NODE_ENV', 'development');
    app.use((0, helmet_1.default)({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }));
    app.enableCors({
        origin: frontendUrl,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    });
    app.setGlobalPrefix('api/v1');
    app.enableVersioning({ type: common_1.VersioningType.URI });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalFilters(new http_exception_filter_1.HttpExceptionFilter());
    app.useGlobalInterceptors(new logging_interceptor_1.LoggingInterceptor());
    if (nodeEnv !== 'production') {
        const swaggerConfig = new swagger_1.DocumentBuilder()
            .setTitle(`${brand_1.appBrand.name} API`)
            .setDescription(`**${brand_1.appBrand.name}** — ${brand_1.appBrand.description}\n\n` +
            'Better Auth endpoints are at `/api/auth/*` (not under `/api/v1`). ' +
            'All domain routes require a `Bearer` JWT obtained via `POST /api/v1/auth/exchange-session`.')
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
        const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
        swagger_1.SwaggerModule.setup('api/docs', app, document, {
            swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
        });
    }
    await app.listen(port);
    console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║                                                      ║
  ║   ${`${brand_1.appBrand.name} — ${brand_1.appBrand.tagline}`.padEnd(51)}║
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
//# sourceMappingURL=main.js.map