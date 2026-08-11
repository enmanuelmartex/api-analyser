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
var ProjectsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const SwaggerParser = require("swagger-parser");
const axios_1 = require("axios");
const url_resolver_util_1 = require("../../common/utils/url-resolver.util");
const crypto_service_1 = require("../../common/crypto/crypto.service");
const auth_config_crypto_1 = require("../../common/crypto/auth-config.crypto");
const openapi_safety_util_1 = require("../../common/utils/openapi-safety.util");
let ProjectsService = ProjectsService_1 = class ProjectsService {
    constructor(prisma, crypto) {
        this.prisma = prisma;
        this.crypto = crypto;
        this.logger = new common_1.Logger(ProjectsService_1.name);
    }
    async findAll(userId) {
        const projects = await this.prisma.project.findMany({
            where: { userId, isActive: true },
            include: {
                apiSpec: {
                    include: { authConfig: true },
                },
                _count: {
                    select: {
                        assessments: true,
                        securityIssues: { where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK'] } } },
                    },
                },
                assessments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { status: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return projects.map(({ assessments, ...project }) => ({
            ...this.toProjectResponse(project),
            openIssuesCount: project._count.securityIssues,
            lastScanStatus: assessments[0]?.status ?? null,
        }));
    }
    async findOne(id, userId) {
        const project = await this.prisma.project.findFirst({
            where: { id, userId, isActive: true },
            include: {
                apiSpec: {
                    include: {
                        authConfig: true,
                        endpoints: { orderBy: [{ path: 'asc' }, { method: 'asc' }] },
                    },
                },
                assessments: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    include: {
                        summary: true,
                    },
                },
                _count: { select: { assessments: true } },
            },
        });
        if (!project)
            throw new common_1.NotFoundException('Project not found');
        return this.toProjectResponse(project);
    }
    async create(userId, dto) {
        return this.prisma.project.create({
            data: {
                name: dto.name,
                description: dto.description,
                baseUrl: dto.baseUrl,
                environment: dto.environment || 'DEVELOPMENT',
                tags: dto.tags || [],
                userId,
                status: 'DRAFT',
                setupStep: 2,
            },
        });
    }
    async createDraft(userId, dto) {
        if (![dto.name, dto.baseUrl, dto.description].some((value) => value?.trim())) {
            throw new common_1.BadRequestException({ message: 'Enter project information before saving a draft.', fieldErrors: {} });
        }
        return this.prisma.project.create({
            data: {
                name: dto.name?.trim() || 'Untitled project',
                description: dto.description,
                baseUrl: dto.baseUrl?.trim() || '',
                environment: dto.environment || 'DEVELOPMENT',
                setupStep: dto.setupStep || 1,
                status: 'DRAFT',
                userId,
            },
        });
    }
    async saveDraft(id, userId, dto) {
        const project = await this.assertOwner(id, userId);
        if (project.status !== 'DRAFT')
            throw new common_1.BadRequestException('Only drafts can be autosaved.');
        return this.prisma.project.update({ where: { id }, data: dto });
    }
    async finalize(id, userId) {
        const project = await this.prisma.project.findFirst({
            where: { id, userId, isActive: true },
            include: { apiSpec: { include: { authConfig: true } } },
        });
        if (!project)
            throw new common_1.NotFoundException('Project not found');
        if (project.status === 'READY')
            return project;
        const fieldErrors = {};
        if (!project.name.trim())
            fieldErrors.name = 'Project name is required.';
        try {
            new URL(project.baseUrl);
        }
        catch {
            fieldErrors.baseUrl = 'Enter a valid API base URL.';
        }
        if (!project.apiSpec)
            fieldErrors.specUrl = 'Upload a valid OpenAPI JSON or YAML document.';
        else if (!this.isAuthComplete(project.apiSpec.authConfig)) {
            fieldErrors.authType = 'Complete the authentication configuration.';
        }
        if (Object.keys(fieldErrors).length) {
            throw new common_1.BadRequestException({ message: 'Complete the required project setup.', fieldErrors });
        }
        return this.prisma.project.update({
            where: { id },
            data: { status: 'READY', setupStep: 3, completedAt: new Date() },
            include: { apiSpec: { select: { id: true, title: true, version: true, source: true } }, _count: { select: { assessments: true } } },
        });
    }
    async update(id, userId, dto) {
        await this.assertOwner(id, userId);
        return this.prisma.project.update({
            where: { id },
            data: dto,
        });
    }
    async remove(id, userId) {
        await this.assertOwner(id, userId);
        return this.prisma.project.update({
            where: { id },
            data: { isActive: false },
        });
    }
    async importOpenApiFromUrl(projectId, userId, url) {
        await this.assertOwner(projectId, userId);
        const validatedUrl = await (0, url_resolver_util_1.assertSafeRemoteUrl)(url);
        const resolvedUrl = (0, url_resolver_util_1.resolveTargetUrl)(validatedUrl);
        this.logger.log(`Importing OpenAPI spec from ${new URL(validatedUrl).hostname}`);
        let rawSpec;
        try {
            const response = await axios_1.default.get(resolvedUrl, {
                timeout: 15000,
                maxRedirects: 0,
                maxContentLength: 5 * 1024 * 1024,
                maxBodyLength: 5 * 1024 * 1024,
                responseType: 'json',
                headers: { Accept: 'application/json, application/yaml, text/yaml' },
            });
            rawSpec = response.data;
        }
        catch (error) {
            this.logger.warn(`Specification URL import failed: ${error instanceof Error ? error.message : 'unknown error'}`);
            throw new common_1.BadRequestException('We could not access the specification URL.');
        }
        return this.parseAndSaveSpec(projectId, rawSpec, 'URL', url);
    }
    async importOpenApiFromContent(projectId, userId, content) {
        await this.assertOwner(projectId, userId);
        return this.parseAndSaveSpec(projectId, content, 'UPLOAD');
    }
    async parseAndSaveSpec(projectId, rawSpec, source, url) {
        (0, openapi_safety_util_1.assertNoExternalRefs)(rawSpec);
        let parsed;
        if ((0, openapi_safety_util_1.isOpenApi31Document)(rawSpec)) {
            parsed = rawSpec;
            this.logger.log('Importing OpenAPI 3.1 document without parser dereference');
        }
        else {
            try {
                parsed = await SwaggerParser.dereference(rawSpec, openapi_safety_util_1.SAFE_PARSER_OPTIONS);
            }
            catch (err) {
                this.logger.warn(`Could not fully dereference spec: ${err.message}`);
                throw new common_1.BadRequestException('Upload a valid OpenAPI JSON or YAML document.');
            }
        }
        const endpoints = this.extractEndpoints(parsed);
        if (!parsed?.openapi && !parsed?.swagger)
            throw new common_1.BadRequestException('Upload a valid OpenAPI document.');
        if (!parsed?.paths || endpoints.length === 0)
            throw new common_1.BadRequestException('The specification does not contain any valid endpoints.');
        const apiSpec = await this.prisma.apiSpec.upsert({
            where: { projectId },
            update: {
                source,
                url,
                rawSpec: rawSpec,
                parsed: parsed,
                title: parsed.info?.title,
                version: parsed.info?.version,
                endpoints: {
                    deleteMany: {},
                    create: endpoints,
                },
            },
            create: {
                projectId,
                source,
                url,
                rawSpec: rawSpec,
                parsed: parsed,
                title: parsed.info?.title,
                version: parsed.info?.version,
                endpoints: { create: endpoints },
            },
            include: {
                endpoints: true,
                authConfig: true,
            },
        });
        this.logger.log(`Parsed ${endpoints.length} endpoints from spec for project ${projectId}`);
        await this.prisma.project.update({ where: { id: projectId }, data: { setupStep: 3 } });
        return apiSpec;
    }
    extractEndpoints(spec) {
        const endpoints = [];
        const paths = spec.paths || {};
        for (const [path, pathItem] of Object.entries(paths)) {
            const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
            for (const method of methods) {
                if (!pathItem[method])
                    continue;
                const operation = pathItem[method];
                endpoints.push({
                    path,
                    method: method.toUpperCase(),
                    summary: operation.summary,
                    description: operation.description,
                    operationId: operation.operationId,
                    tags: operation.tags || [],
                    parameters: operation.parameters || [],
                    requestBody: operation.requestBody || null,
                    responses: operation.responses || {},
                    security: operation.security || spec.security || [],
                    deprecated: operation.deprecated || false,
                });
            }
        }
        return endpoints;
    }
    async saveAuthConfig(projectId, userId, authData) {
        await this.assertOwner(projectId, userId);
        const apiSpec = await this.prisma.apiSpec.findUnique({ where: { projectId } });
        if (!apiSpec)
            throw new common_1.NotFoundException('API spec not found. Please import a spec first.');
        const allowedTypes = ['NONE', 'BEARER', 'BASIC', 'API_KEY', 'OAUTH2'];
        if (!allowedTypes.includes(authData.type))
            throw new common_1.BadRequestException('Select a valid authentication type.');
        if (authData.type === 'BEARER' && !authData.token?.trim())
            throw new common_1.BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { token: 'A bearer token is required.' } });
        if (authData.type === 'BASIC' && (!authData.username?.trim() || !authData.password))
            throw new common_1.BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { username: !authData.username?.trim() ? 'Username is required.' : undefined, password: !authData.password ? 'Password is required.' : undefined } });
        if (authData.type === 'API_KEY' && (!authData.apiKey || !authData.apiKeyHeader?.trim()))
            throw new common_1.BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { apiKey: !authData.apiKey ? 'An API key is required.' : undefined, apiKeyHeader: !authData.apiKeyHeader?.trim() ? 'Key name is required.' : undefined } });
        if (authData.type === 'OAUTH2' && (!authData.clientId || !authData.clientSecret || !authData.tokenUrl))
            throw new common_1.BadRequestException('OAuth 2.0 configuration is incomplete.');
        const safeAuthData = Object.fromEntries(Object.entries(authData).filter(([key]) => ['type', 'token', 'username', 'password', 'apiKey', 'apiKeyHeader', 'apiKeyLocation', 'clientId', 'clientSecret', 'tokenUrl', 'scopes'].includes(key)));
        const encrypted = (0, auth_config_crypto_1.encryptAuthFields)(this.crypto, safeAuthData);
        const result = await this.prisma.authConfig.upsert({
            where: { apiSpecId: apiSpec.id },
            update: encrypted,
            create: { apiSpecId: apiSpec.id, ...encrypted },
        });
        await this.prisma.project.update({ where: { id: projectId }, data: { setupStep: 3 } });
        return (0, auth_config_crypto_1.stripAuthSecrets)(result);
    }
    async assertOwner(projectId, userId) {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, userId },
        });
        if (!project)
            throw new common_1.ForbiddenException('Project not found or access denied');
        return project;
    }
    toProjectResponse(project) {
        const firstIncompleteStep = this.getFirstIncompleteStep(project);
        const apiSpec = project.apiSpec
            ? { ...project.apiSpec, authConfig: this.sanitizeAuthConfig(project.apiSpec.authConfig) }
            : project.apiSpec;
        return {
            ...project,
            apiSpec,
            setupStep: project.status === 'DRAFT' ? firstIncompleteStep ?? 3 : 3,
        };
    }
    getFirstIncompleteStep(project) {
        if (!project.name.trim() || !this.isValidUrl(project.baseUrl))
            return 1;
        if (!project.apiSpec)
            return 2;
        if (!this.isAuthComplete(project.apiSpec.authConfig))
            return 3;
        return null;
    }
    isValidUrl(value) {
        try {
            new URL(value);
            return true;
        }
        catch {
            return false;
        }
    }
    isAuthComplete(authConfig) {
        if (!authConfig)
            return false;
        if (authConfig.type === 'NONE')
            return true;
        if (authConfig.type === 'BEARER')
            return Boolean(authConfig.token?.trim());
        if (authConfig.type === 'BASIC')
            return Boolean(authConfig.username?.trim() && authConfig.password);
        if (authConfig.type === 'API_KEY')
            return Boolean(authConfig.apiKey && authConfig.apiKeyHeader?.trim());
        if (authConfig.type === 'OAUTH2')
            return Boolean(authConfig.clientId && authConfig.clientSecret && this.isValidUrl(authConfig.tokenUrl ?? ''));
        return false;
    }
    sanitizeAuthConfig(authConfig) {
        return (0, auth_config_crypto_1.stripAuthSecrets)(authConfig);
    }
};
exports.ProjectsService = ProjectsService;
exports.ProjectsService = ProjectsService = ProjectsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        crypto_service_1.CryptoService])
], ProjectsService);
//# sourceMappingURL=projects.service.js.map