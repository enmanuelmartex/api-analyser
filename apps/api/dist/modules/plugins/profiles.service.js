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
exports.ProfilesService = exports.SYSTEM_PROFILES = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_registry_service_1 = require("./plugin-registry.service");
exports.SYSTEM_PROFILES = [
    {
        id: 'full-scan',
        name: 'Full Scan',
        description: 'Runs all available security plugins. Recommended for complete audits.',
        icon: 'shield',
        enabledPlugins: [
            'security-headers', 'cors', 'broken-authentication', 'jwt-analysis',
            'bola', 'bfla', 'mass-assignment', 'rate-limit', 'sensitive-data', 'ssrf',
            'business-flows', 'inventory', 'api-consumption',
        ],
    },
    {
        id: 'quick-scan',
        name: 'Quick Scan',
        description: 'Fast scan covering the most critical categories. Ideal for CI pipelines.',
        icon: 'zap',
        enabledPlugins: ['security-headers', 'cors', 'broken-authentication', 'sensitive-data'],
    },
    {
        id: 'auth-audit',
        name: 'Authentication Audit',
        description: 'Deep dive into authentication and authorization controls.',
        icon: 'lock',
        enabledPlugins: ['broken-authentication', 'jwt-analysis', 'bola', 'bfla'],
    },
    {
        id: 'headers-audit',
        name: 'Headers Audit',
        description: 'Focuses on HTTP security headers and CORS configuration.',
        icon: 'layers',
        enabledPlugins: ['security-headers', 'cors'],
    },
    {
        id: 'owasp-api-top10',
        name: 'OWASP API Top 10',
        description: 'Covers all OWASP API Security Top 10 categories (2023).',
        icon: 'list',
        enabledPlugins: [
            'bola', 'broken-authentication', 'jwt-analysis', 'mass-assignment',
            'sensitive-data', 'rate-limit', 'bfla', 'business-flows', 'ssrf',
            'security-headers', 'cors', 'inventory', 'api-consumption',
        ],
    },
    {
        id: 'compliance',
        name: 'Compliance Scan',
        description: 'Targets PII/sensitive data exposure and security header requirements.',
        icon: 'check-circle',
        enabledPlugins: ['sensitive-data', 'security-headers', 'cors'],
    },
];
let ProfilesService = class ProfilesService {
    constructor(prisma, registry) {
        this.prisma = prisma;
        this.registry = registry;
    }
    assertChecksExist(enabledPlugins) {
        if (!enabledPlugins)
            return;
        const unknown = enabledPlugins.filter((id) => !this.registry.has(id));
        if (unknown.length > 0) {
            throw new common_1.BadRequestException(`Unknown security check${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
        }
        const duplicates = enabledPlugins.filter((id, index) => enabledPlugins.indexOf(id) !== index);
        if (duplicates.length > 0) {
            throw new common_1.BadRequestException(`Duplicate security check${duplicates.length > 1 ? 's' : ''}: ${[...new Set(duplicates)].join(', ')}`);
        }
    }
    async onModuleInit() {
        await this.seedSystemProfiles();
    }
    async seedSystemProfiles() {
        for (const profile of exports.SYSTEM_PROFILES) {
            await this.prisma.scanProfile.upsert({
                where: { id: profile.id },
                create: { ...profile, isSystem: true },
                update: { name: profile.name, description: profile.description, enabledPlugins: profile.enabledPlugins },
            });
        }
    }
    async findAll(userId) {
        return this.prisma.scanProfile.findMany({
            where: { OR: [{ isSystem: true }, { userId }] },
            orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
        });
    }
    async findOne(profileId, userId) {
        const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
        if (!profile)
            throw new common_1.NotFoundException('Scan profile not found');
        if (!profile.isSystem && profile.userId !== userId)
            throw new common_1.ForbiddenException();
        return profile;
    }
    async create(userId, dto) {
        this.assertChecksExist(dto.enabledPlugins);
        return this.prisma.scanProfile.create({
            data: { ...dto, userId, isSystem: false },
        });
    }
    async update(profileId, userId, dto) {
        const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
        if (!profile)
            throw new common_1.NotFoundException('Scan profile not found');
        if (profile.isSystem)
            throw new common_1.ForbiddenException('Cannot modify system profiles');
        if (profile.userId !== userId)
            throw new common_1.ForbiddenException();
        this.assertChecksExist(dto.enabledPlugins);
        return this.prisma.scanProfile.update({ where: { id: profileId }, data: dto });
    }
    async remove(profileId, userId) {
        const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
        if (!profile)
            throw new common_1.NotFoundException('Scan profile not found');
        if (profile.isSystem)
            throw new common_1.ForbiddenException('Cannot delete system profiles');
        if (profile.userId !== userId)
            throw new common_1.ForbiddenException();
        await this.prisma.scanProfile.delete({ where: { id: profileId } });
        return { deleted: true };
    }
};
exports.ProfilesService = ProfilesService;
exports.ProfilesService = ProfilesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_registry_service_1.PluginRegistryService])
], ProfilesService);
//# sourceMappingURL=profiles.service.js.map