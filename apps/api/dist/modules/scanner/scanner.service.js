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
var ScannerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerService = void 0;
const common_1 = require("@nestjs/common");
const ai_service_1 = require("../ai/ai.service");
const plugin_registry_service_1 = require("../plugins/plugin-registry.service");
const plugin_executor_service_1 = require("../plugins/plugin-executor.service");
let ScannerService = ScannerService_1 = class ScannerService {
    constructor(aiService, pluginRegistry, pluginExecutor) {
        this.aiService = aiService;
        this.pluginRegistry = pluginRegistry;
        this.pluginExecutor = pluginExecutor;
        this.logger = new common_1.Logger(ScannerService_1.name);
    }
    async runAllPlugins(context, onProgress, onLog, userId, pluginOverride) {
        const allFindings = [];
        const enabledPlugins = pluginOverride !== undefined
            ? pluginOverride
            : userId
                ? await this.pluginRegistry.getEnabledForUser(userId)
                : await this.pluginRegistry.getEnabledGlobally();
        const allRegistered = this.pluginRegistry.getAll();
        const enabledIds = new Set(enabledPlugins.map((p) => p.manifest.id));
        const plan = {
            available: allRegistered.map((p) => p.manifest.id),
            executed: [],
            failed: [],
            skipped: [],
            skippedReason: {},
            versions: Object.fromEntries(allRegistered.map((p) => [p.manifest.id, p.manifest.version])),
            durationMs: {},
            findingCounts: {},
        };
        for (const p of allRegistered) {
            if (!enabledIds.has(p.manifest.id)) {
                plan.skipped.push(p.manifest.id);
                plan.skippedReason[p.manifest.id] = userId ? 'disabled_by_user' : 'disabled_globally';
            }
        }
        onLog({
            level: 'info',
            plugin: 'core',
            message: `Plugin execution plan: ${enabledPlugins.length} enabled, ${plan.skipped.length} skipped`,
        });
        if (plan.skipped.length > 0) {
            onLog({
                level: 'info',
                plugin: 'core',
                message: `Skipped plugins: ${plan.skipped.join(', ')}`,
            });
        }
        const totalSteps = enabledPlugins.length + 2;
        let stepIndex = 2;
        for (const plugin of enabledPlugins) {
            const pluginId = plugin.manifest.id;
            const pluginName = plugin.manifest.name;
            const progress = Math.round((stepIndex / totalSteps) * 82) + 8;
            const pluginConfig = userId
                ? await this.pluginRegistry.getPluginConfig(pluginId, userId)
                : (plugin.manifest.defaultConfig ?? {});
            onProgress({
                step: pluginName,
                stepIndex,
                totalSteps,
                progress,
                message: `Running ${pluginName}...`,
                findingsCount: allFindings.length,
                currentPlugin: pluginId,
                assessmentId: context.assessmentId,
            });
            onLog({ level: 'info', plugin: pluginId, message: `Starting ${pluginName}` });
            const { findings, durationMs, status } = await this.pluginExecutor.executeInPipeline(plugin, context, userId ?? 'system', pluginConfig);
            allFindings.push(...findings);
            plan.executed.push(pluginId);
            if (status !== 'SUCCESS') {
                plan.failed.push(pluginId);
                plan.skippedReason[pluginId] = `execution_${status.toLowerCase()}`;
            }
            plan.durationMs[pluginId] = durationMs;
            plan.findingCounts[pluginId] = findings.length;
            const logLevel = status === 'SUCCESS' ? 'info' : (status === 'TIMEOUT' ? 'warn' : 'error');
            onLog({
                level: logLevel,
                plugin: pluginId,
                message: status === 'SUCCESS'
                    ? `${pluginName} completed — ${findings.length} finding(s) in ${durationMs}ms`
                    : `${pluginName} ${status.toLowerCase()} after ${durationMs}ms`,
            });
            stepIndex++;
        }
        let aiMeta = {
            provider: 'none',
            model: 'none',
            available: false,
            status: 'skipped',
            analyzed: 0,
            skipped: allFindings.length,
            durationMs: 0,
            tokensUsed: 0,
            reason: 'AI analysis disabled for this assessment',
        };
        if (context.config.enableAiAnalysis) {
            onProgress({
                step: 'AI Analysis',
                stepIndex: totalSteps - 1,
                totalSteps,
                progress: 92,
                message: `AI analysis on ${allFindings.length} findings...`,
                findingsCount: allFindings.length,
                currentPlugin: 'ai-analysis',
                assessmentId: context.assessmentId,
            });
            onLog({ level: 'info', plugin: 'ai-analysis', message: 'Starting AI-powered analysis' });
            aiMeta = await this.aiService.analyzeFindings(allFindings, context);
            if (aiMeta.available) {
                onLog({
                    level: 'info',
                    plugin: 'ai-analysis',
                    message: `AI analysis complete — ${aiMeta.analyzed} findings enriched by ${aiMeta.provider} in ${aiMeta.durationMs}ms`,
                });
            }
            else {
                onLog({
                    level: 'warn',
                    plugin: 'ai-analysis',
                    message: `AI analysis skipped: ${aiMeta.reason ?? 'provider unavailable'}`,
                });
            }
        }
        return { findings: allFindings, pluginPlan: plan, aiMeta };
    }
};
exports.ScannerService = ScannerService;
exports.ScannerService = ScannerService = ScannerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ai_service_1.AiService,
        plugin_registry_service_1.PluginRegistryService,
        plugin_executor_service_1.PluginExecutorService])
], ScannerService);
//# sourceMappingURL=scanner.service.js.map