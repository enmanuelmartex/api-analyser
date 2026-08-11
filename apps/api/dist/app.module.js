"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const bullmq_1 = require("@nestjs/bullmq");
const throttler_1 = require("@nestjs/throttler");
const configuration_1 = require("./config/configuration");
const env_validation_1 = require("./config/env.validation");
const crypto_module_1 = require("./common/crypto/crypto.module");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const projects_module_1 = require("./modules/projects/projects.module");
const assessments_module_1 = require("./modules/assessments/assessments.module");
const issues_module_1 = require("./modules/issues/issues.module");
const scoring_module_1 = require("./modules/scoring/scoring.module");
const reports_module_1 = require("./modules/reports/reports.module");
const scanner_module_1 = require("./modules/scanner/scanner.module");
const plugins_module_1 = require("./modules/plugins/plugins.module");
const ai_module_1 = require("./modules/ai/ai.module");
const audit_module_1 = require("./modules/audit/audit.module");
const system_module_1 = require("./modules/system/system.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                envFilePath: ['.env.local', '.env'],
                validate: env_validation_1.validateEnv,
            }),
            event_emitter_1.EventEmitterModule.forRoot({
                wildcard: true,
                delimiter: '.',
                maxListeners: 20,
            }),
            bullmq_1.BullModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (configService) => ({
                    connection: {
                        url: configService.get('redis.url'),
                    },
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: { type: 'exponential', delay: 1000 },
                        removeOnComplete: { count: 100 },
                        removeOnFail: { count: 50 },
                    },
                }),
            }),
            throttler_1.ThrottlerModule.forRoot([
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
            crypto_module_1.CryptoModule,
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            projects_module_1.ProjectsModule,
            assessments_module_1.AssessmentsModule,
            issues_module_1.IssuesModule,
            scoring_module_1.ScoringModule,
            reports_module_1.ReportsModule,
            scanner_module_1.ScannerModule,
            plugins_module_1.PluginsModule,
            ai_module_1.AiModule,
            audit_module_1.AuditModule,
            system_module_1.SystemModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map