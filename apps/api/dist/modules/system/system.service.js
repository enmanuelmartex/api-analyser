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
exports.SystemService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_registry_service_1 = require("../plugins/plugin-registry.service");
const brand_1 = require("../../brand/brand");
let SystemService = class SystemService {
    constructor(prisma, registry) {
        this.prisma = prisma;
        this.registry = registry;
    }
    async getInfo() {
        const manifests = this.registry.getAllManifests();
        const rows = await this.prisma.plugin.findMany({
            select: { id: true, isEnabled: true },
        });
        const enabledById = new Map(rows.map((row) => [row.id, row.isEnabled]));
        const checks = manifests.map((manifest) => ({
            id: manifest.id,
            name: manifest.name,
            category: manifest.category,
            owaspMappings: manifest.owaspMappings,
            ruleCount: manifest.ruleIds.length,
            isEnabled: enabledById.get(manifest.id) ?? true,
        }));
        return {
            product: {
                name: brand_1.appBrand.name,
                version: process.env.npm_package_version ?? '0.1.0',
                tagline: brand_1.appBrand.tagline,
                domain: brand_1.appBrand.domain,
            },
            runtime: {
                apiFramework: 'NestJS 10',
                bunVersion: process.versions.bun ?? null,
                nodeVersion: process.version,
                uptimeSeconds: Math.floor(process.uptime()),
                environment: process.env.NODE_ENV ?? 'development',
            },
            securityChecks: {
                total: checks.length,
                enabled: checks.filter((check) => check.isEnabled).length,
                totalRules: checks.reduce((total, check) => total + check.ruleCount, 0),
                checks,
            },
            owasp: this.registry.getOwaspCoverage(),
        };
    }
};
exports.SystemService = SystemService;
exports.SystemService = SystemService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_registry_service_1.PluginRegistryService])
], SystemService);
//# sourceMappingURL=system.service.js.map