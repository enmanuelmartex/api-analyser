"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PluginExecutorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginExecutorService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_registry_service_1 = require("./plugin-registry.service");
let PluginExecutorService = PluginExecutorService_1 = class PluginExecutorService {
    constructor(prisma, registry) {
        this.prisma = prisma;
        this.registry = registry;
        this.logger = new common_1.Logger(PluginExecutorService_1.name);
        this.DEFAULT_TIMEOUT_MS = 30_000;
    }
    async runSinglePlugin(options) {
        const { pluginId, userId, projectId, assessmentId, pluginConfig, timeoutMs } = options;
        const plugin = this.registry.getById(pluginId);
        if (!plugin) {
            return {
                pluginId,
                pluginName: pluginId,
                status: 'FAILED',
                findingsCount: 0,
                durationMs: 0,
                findings: [],
                error: `Plugin "${pluginId}" not found in registry`,
                executionId: '',
            };
        }
        const execution = await this.prisma.pluginExecution.create({
            data: {
                pluginId,
                assessmentId: assessmentId ?? null,
                userId,
                status: 'SUCCESS',
                startedAt: new Date(),
            },
        });
        const startedAt = Date.now();
        const deadline = timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
        let status = 'SUCCESS';
        let errorMessage;
        let findings = [];
        try {
            const project = await this.prisma.project.findUniqueOrThrow({
                where: { id: projectId },
                include: {
                    apiSpec: {
                        include: { authConfig: true, endpoints: true },
                    },
                },
            });
            if (!project.apiSpec)
                throw new Error('Project has no imported API spec');
            const context = this.buildContext(project, assessmentId ?? 'single-run', pluginConfig);
            const resultPromise = plugin.run(context, pluginConfig ?? {});
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Plugin timed out after ${deadline}ms`)), deadline));
            const result = await Promise.race([resultPromise, timeoutPromise]);
            findings = result.findings;
        }
        catch (error) {
            const isTimeout = error.message.includes('timed out');
            status = isTimeout ? 'TIMEOUT' : 'FAILED';
            errorMessage = error.message;
            this.logger.error(`Plugin ${pluginId} ${status}: ${error.message}`);
        }
        const durationMs = Date.now() - startedAt;
        await this.prisma.pluginExecution.update({
            where: { id: execution.id },
            data: {
                status,
                completedAt: new Date(),
                durationMs,
                findingsCount: findings.length,
                errorMessage,
            },
        });
        return {
            pluginId,
            pluginName: plugin.manifest.name,
            status,
            findingsCount: findings.length,
            durationMs,
            findings,
            error: errorMessage,
            executionId: execution.id,
        };
    }
    async executeInPipeline(plugin, context, userId, pluginConfig = {}) {
        const startedAt = Date.now();
        const execution = await this.prisma.pluginExecution.create({
            data: {
                pluginId: plugin.manifest.id,
                assessmentId: context.assessmentId,
                userId,
                status: 'SUCCESS',
                startedAt: new Date(),
            },
        });
        let status = 'SUCCESS';
        let findings = [];
        let errorMessage;
        try {
            const result = await Promise.race([
                plugin.run(context, pluginConfig),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin timeout')), context.config.timeoutMs * 3)),
            ]);
            findings = result.findings;
        }
        catch (error) {
            status = error.message.includes('timeout') ? 'TIMEOUT' : 'FAILED';
            errorMessage = error.message;
        }
        const durationMs = Date.now() - startedAt;
        await this.prisma.pluginExecution.update({
            where: { id: execution.id },
            data: { status, completedAt: new Date(), durationMs, findingsCount: findings.length, errorMessage },
        });
        return { findings, durationMs, status };
    }
    buildContext(project, assessmentId, _pluginConfig) {
        const spec = project.apiSpec;
        const auth = spec.authConfig;
        return {
            assessmentId,
            projectId: project.id,
            baseUrl: project.baseUrl,
            auth: {
                type: auth?.type ?? 'NONE',
                token: auth?.token ?? undefined,
                username: auth?.username ?? undefined,
                password: auth?.password ?? undefined,
                apiKey: auth?.apiKey ?? undefined,
                apiKeyHeader: auth?.apiKeyHeader ?? undefined,
                apiKeyLocation: auth?.apiKeyLocation ?? 'header',
                customHeaders: auth?.customHeaders ?? undefined,
            },
            endpoints: (spec.endpoints ?? []).map((e) => ({
                id: e.id,
                path: e.path,
                method: e.method,
                summary: e.summary ?? undefined,
                tags: e.tags ?? [],
                parameters: e.parameters ?? [],
                requestBody: e.requestBody ?? undefined,
                responses: e.responses ?? undefined,
                security: e.security ?? [],
                deprecated: e.deprecated ?? false,
            })),
            config: {
                executionMode: 'manual',
                enableAiAnalysis: false,
                maxRequestsPerEndpoint: 5,
                requestDelayMs: 100,
                timeoutMs: 10000,
            },
        };
    }
};
exports.PluginExecutorService = PluginExecutorService;
exports.PluginExecutorService = PluginExecutorService = PluginExecutorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_registry_service_1.PluginRegistryService])
], PluginExecutorService);
//# sourceMappingURL=plugin-executor.service.js.map