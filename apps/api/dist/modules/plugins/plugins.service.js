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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_registry_service_1 = require("./plugin-registry.service");
let PluginsService = class PluginsService {
    constructor(prisma, registry) {
        this.prisma = prisma;
        this.registry = registry;
    }
    async findAll(userId) {
        const [dbPlugins, userConfigs, execStats] = await Promise.all([
            this.prisma.plugin.findMany({ orderBy: { category: 'asc' } }),
            this.prisma.pluginUserConfig.findMany({
                where: { userId },
                select: { pluginId: true, isEnabled: true, config: true },
            }),
            this.prisma.pluginExecution.groupBy({
                by: ['pluginId'],
                _count: { id: true },
                _avg: { durationMs: true },
                where: { userId },
            }),
        ]);
        const userConfigMap = new Map(userConfigs.map((c) => [c.pluginId, c]));
        const statsMap = new Map(execStats.map((s) => [s.pluginId, s]));
        return dbPlugins.map((p) => {
            const userCfg = userConfigMap.get(p.id);
            const stats = statsMap.get(p.id);
            return {
                ...p,
                isEnabled: userCfg !== undefined ? userCfg.isEnabled : p.isEnabled,
                userConfig: userCfg?.config ?? null,
                stats: {
                    totalExecutions: stats?._count?.id ?? 0,
                    avgDurationMs: Math.round(stats?._avg?.durationMs ?? 0),
                },
            };
        });
    }
    async findOne(pluginId, userId) {
        const plugin = await this.prisma.plugin.findUnique({ where: { id: pluginId } });
        if (!plugin)
            throw new common_1.NotFoundException(`Plugin "${pluginId}" not found`);
        const [userConfig, recentExecutions, findingStats] = await Promise.all([
            this.prisma.pluginUserConfig.findUnique({
                where: { pluginId_userId: { pluginId, userId } },
            }),
            this.prisma.pluginExecution.findMany({
                where: { pluginId, userId },
                orderBy: { startedAt: 'desc' },
                take: 20,
            }),
            this.prisma.securityIssue.groupBy({
                by: ['severity'],
                _count: { id: true },
                where: { pluginId, project: { userId, isActive: true } },
            }),
        ]);
        const totalExecutions = recentExecutions.length;
        const successful = recentExecutions.filter((e) => e.status === 'SUCCESS').length;
        const avgDuration = totalExecutions
            ? Math.round(recentExecutions.reduce((s, e) => s + (e.durationMs ?? 0), 0) / totalExecutions)
            : 0;
        return {
            ...plugin,
            isEnabled: userConfig?.isEnabled ?? plugin.isEnabled,
            userConfig: userConfig?.config ?? null,
            stats: {
                totalExecutions,
                successRate: totalExecutions ? Math.round((successful / totalExecutions) * 100) : 0,
                avgDurationMs: avgDuration,
                findingsBySeverity: Object.fromEntries(findingStats.map((s) => [s.severity, s._count.id])),
            },
            recentExecutions,
        };
    }
    async toggle(pluginId, userId, isEnabled) {
        if (!this.registry.has(pluginId))
            throw new common_1.NotFoundException(`Plugin "${pluginId}" not found`);
        return this.prisma.pluginUserConfig.upsert({
            where: { pluginId_userId: { pluginId, userId } },
            create: { pluginId, userId, isEnabled },
            update: { isEnabled },
        });
    }
    async saveConfig(pluginId, userId, config) {
        if (!this.registry.has(pluginId))
            throw new common_1.NotFoundException(`Plugin "${pluginId}" not found`);
        return this.prisma.pluginUserConfig.upsert({
            where: { pluginId_userId: { pluginId, userId } },
            create: { pluginId, userId, config },
            update: { config },
        });
    }
    async getExecutionHistory(pluginId, userId, limit = 50) {
        return this.prisma.pluginExecution.findMany({
            where: { pluginId, userId },
            orderBy: { startedAt: 'desc' },
            take: limit,
        });
    }
    async getIssues(pluginId, userId, limit = 50) {
        return this.prisma.securityIssue.findMany({
            where: {
                pluginId,
                project: { userId, isActive: true },
            },
            include: {
                project: { select: { id: true, name: true } },
            },
            orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
            take: limit,
        });
    }
};
exports.PluginsService = PluginsService;
exports.PluginsService = PluginsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_registry_service_1.PluginRegistryService])
], PluginsService);
//# sourceMappingURL=plugins.service.js.map