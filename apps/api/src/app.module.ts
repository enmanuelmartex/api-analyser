import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { ScheduledScansModule } from './modules/scheduled-scans/scheduled-scans.module';
import { IssuesModule } from './modules/issues/issues.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { PluginsModule } from './modules/plugins/plugins.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { SystemModule } from './modules/system/system.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EmailModule } from './modules/email/email.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Resolved against the cwd, which is apps/api for both `bun dev` and
      // `start:prod`. The monorepo root is the documented home of the from-source
      // `.env` (see scripts/setup-env.mjs), and `bun --cwd apps/api` does not
      // inherit it, so fall back to it explicitly. First file to define a
      // variable wins, so a local apps/api/.env still takes precedence. Under
      // Docker the cwd is /app and the root paths simply do not exist — the
      // container gets its environment from compose.
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      // Aborts boot when a security-critical variable is missing or weak.
      validate: validateEnv,
    }),

    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('redis.url'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      }),
    }),

    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 20,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 100,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 500,
      },
    ]),

    CryptoModule,
    PrismaModule,
    // Global, and listed before its consumers so the settings cache is warm
    // before the first audit write asks whether collection is enabled.
    SettingsModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    AssessmentsModule,
    // After AssessmentsModule, which it calls into: a scheduled run goes
    // through the same `createAndRun` the Run Assessment button uses.
    ScheduledScansModule,
    IssuesModule,
    ScoringModule,
    ReportsModule,
    ScannerModule,
    PluginsModule,
    AiModule,
    NotificationsModule,
    // After NotificationsModule and ReportsModule, both of which it reads:
    // preferences decide whether a message is sent, and the stored PDF is what
    // gets attached.
    EmailModule,
    AuditModule,
    SystemModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * Correlation ids are assigned before anything else runs, so every log line,
   * audit event and error produced by a request can be tied back to it.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
