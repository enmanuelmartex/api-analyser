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
var PluginRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginRegistryService = void 0;
exports.createBuiltinPlugins = createBuiltinPlugins;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_manifest_types_1 = require("../scanner/types/plugin-manifest.types");
const rule_declarations_util_1 = require("./rule-declarations.util");
const owasp_coverage_1 = require("./owasp-coverage");
const security_headers_plugin_1 = require("../scanner/plugins/headers/security-headers.plugin");
const cors_plugin_1 = require("../scanner/plugins/cors/cors.plugin");
const broken_auth_plugin_1 = require("../scanner/plugins/authentication/broken-auth.plugin");
const jwt_analysis_plugin_1 = require("../scanner/plugins/jwt/jwt-analysis.plugin");
const bola_plugin_1 = require("../scanner/plugins/authorization/bola.plugin");
const bfla_plugin_1 = require("../scanner/plugins/authorization/bfla.plugin");
const mass_assignment_plugin_1 = require("../scanner/plugins/mass-assignment/mass-assignment.plugin");
const rate_limit_plugin_1 = require("../scanner/plugins/rate-limit/rate-limit.plugin");
const sensitive_data_plugin_1 = require("../scanner/plugins/sensitive-data/sensitive-data.plugin");
const ssrf_plugin_1 = require("../scanner/plugins/ssrf/ssrf.plugin");
const business_flows_plugin_1 = require("../scanner/plugins/business-flows/business-flows.plugin");
const inventory_plugin_1 = require("../scanner/plugins/inventory/inventory.plugin");
const api_consumption_plugin_1 = require("../scanner/plugins/api-consumption/api-consumption.plugin");
function createBuiltinPlugins() {
    return [
        new security_headers_plugin_1.SecurityHeadersPlugin(),
        new cors_plugin_1.CorsPlugin(),
        new broken_auth_plugin_1.BrokenAuthPlugin(),
        new jwt_analysis_plugin_1.JwtAnalysisPlugin(),
        new bola_plugin_1.BolaPlugin(),
        new bfla_plugin_1.BflaPlugin(),
        new mass_assignment_plugin_1.MassAssignmentPlugin(),
        new rate_limit_plugin_1.RateLimitPlugin(),
        new sensitive_data_plugin_1.SensitiveDataPlugin(),
        new ssrf_plugin_1.SsrfPlugin(),
        new business_flows_plugin_1.BusinessFlowsPlugin(),
        new inventory_plugin_1.InventoryPlugin(),
        new api_consumption_plugin_1.ApiConsumptionPlugin(),
    ];
}
let PluginRegistryService = PluginRegistryService_1 = class PluginRegistryService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(PluginRegistryService_1.name);
        this.registry = new Map();
        this.declaredRuleIds = new Set();
    }
    async onModuleInit() {
        this.registerBuiltins();
        this.validateRuleDeclarations();
        await this.syncToDatabase();
    }
    validateRuleDeclarations() {
        const manifests = this.getAllManifests();
        const problems = (0, rule_declarations_util_1.findRuleDeclarationProblems)(manifests);
        if (problems.length > 0) {
            throw new Error('Invalid plugin rule declarations — refusing to start:\n' +
                problems.map((problem) => `  • ${problem}`).join('\n'));
        }
        this.declaredRuleIds = (0, rule_declarations_util_1.collectDeclaredRuleIds)(manifests);
        this.logger.log(`Validated ${this.declaredRuleIds.size} rule ids across ${this.registry.size} plugins`);
    }
    isDeclaredRule(pluginId, ruleId) {
        const plugin = this.registry.get(pluginId);
        return plugin ? plugin.manifest.ruleIds.includes(ruleId) : false;
    }
    getDeclaredRuleIds() {
        return this.declaredRuleIds;
    }
    register(plugin) {
        if (this.registry.has(plugin.manifest.id)) {
            this.logger.warn(`Plugin "${plugin.manifest.id}" is already registered — skipping`);
            return;
        }
        this.registry.set(plugin.manifest.id, plugin);
        this.logger.debug(`Registered plugin: ${plugin.manifest.id} v${plugin.manifest.version}`);
    }
    registerBuiltins() {
        const builtins = createBuiltinPlugins();
        for (const plugin of builtins) {
            this.register(plugin);
        }
        this.logger.log(`Registered ${builtins.length} built-in plugins`);
    }
    async syncToDatabase() {
        try {
            for (const plugin of this.registry.values()) {
                const m = plugin.manifest;
                await this.prisma.plugin.upsert({
                    where: { id: m.id },
                    create: {
                        id: m.id,
                        name: m.name,
                        version: m.version,
                        description: m.description,
                        longDescription: m.longDescription,
                        author: m.author,
                        license: m.license,
                        category: this.toPrismaCategory(m.category),
                        owaspMappings: m.owaspMappings,
                        cweIds: m.cweIds ?? [],
                        tags: m.tags,
                        isBuiltin: m.isBuiltin,
                        isEnabled: true,
                        configSchema: m.configFields ? { fields: m.configFields } : undefined,
                        defaultConfig: m.defaultConfig,
                        permissions: m.permissions,
                        documentationUrl: m.documentationUrl,
                        changelog: m.changelog,
                        minimumCoreVersion: m.minimumCoreVersion,
                    },
                    update: {
                        name: m.name,
                        version: m.version,
                        description: m.description,
                        longDescription: m.longDescription,
                        author: m.author,
                        category: this.toPrismaCategory(m.category),
                        owaspMappings: m.owaspMappings,
                        cweIds: m.cweIds ?? [],
                        tags: m.tags,
                        configSchema: m.configFields ? { fields: m.configFields } : undefined,
                        defaultConfig: m.defaultConfig,
                        permissions: m.permissions,
                    },
                });
            }
            this.logger.log(`Synced ${this.registry.size} plugins to database`);
        }
        catch (error) {
            this.logger.error(`Failed to sync plugins to DB: ${error.message}`);
        }
    }
    toPrismaCategory(category) {
        return (Object.entries(plugin_manifest_types_1.PluginCategory).find(([, v]) => v === category)?.[0] ??
            category.toUpperCase().replace(/\s+/g, '_'));
    }
    getAll() {
        return Array.from(this.registry.values());
    }
    getById(id) {
        return this.registry.get(id);
    }
    getAllManifests() {
        return this.getAll().map((p) => p.manifest);
    }
    getOwaspCoverage() {
        return (0, owasp_coverage_1.computeOwaspCoverage)(this.getAllManifests());
    }
    has(id) {
        return this.registry.has(id);
    }
    async getEnabledForUser(userId) {
        const [globalPlugins, userConfigs] = await Promise.all([
            this.prisma.plugin.findMany({ select: { id: true, isEnabled: true } }),
            this.prisma.pluginUserConfig.findMany({
                where: { userId },
                select: { pluginId: true, isEnabled: true },
            }),
        ]);
        const userConfigMap = new Map(userConfigs.map((c) => [c.pluginId, c.isEnabled]));
        return globalPlugins
            .filter((p) => {
            if (userConfigMap.has(p.id))
                return userConfigMap.get(p.id);
            return p.isEnabled;
        })
            .map((p) => this.registry.get(p.id))
            .filter((p) => p !== undefined);
    }
    async getEnabledGlobally() {
        const globalPlugins = await this.prisma.plugin.findMany({
            where: { isEnabled: true },
            select: { id: true },
        });
        return globalPlugins
            .map((p) => this.registry.get(p.id))
            .filter((p) => p !== undefined);
    }
    getByIds(pluginIds) {
        return pluginIds
            .map((id) => this.registry.get(id))
            .filter((p) => p !== undefined);
    }
    async getPluginConfig(pluginId, userId) {
        const plugin = this.registry.get(pluginId);
        if (!plugin)
            return {};
        const defaults = plugin.manifest.defaultConfig ?? {};
        const userConfig = await this.prisma.pluginUserConfig.findUnique({
            where: { pluginId_userId: { pluginId, userId } },
            select: { config: true },
        });
        return { ...defaults, ...(userConfig?.config ?? {}) };
    }
};
exports.PluginRegistryService = PluginRegistryService;
exports.PluginRegistryService = PluginRegistryService = PluginRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PluginRegistryService);
//# sourceMappingURL=plugin-registry.service.js.map