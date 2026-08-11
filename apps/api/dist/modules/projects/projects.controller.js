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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const projects_service_1 = require("./projects.service");
const create_project_dto_1 = require("./dto/create-project.dto");
const audit_service_1 = require("../audit/audit.service");
let ProjectsController = class ProjectsController {
    constructor(projectsService, audit) {
        this.projectsService = projectsService;
        this.audit = audit;
    }
    findAll(user) {
        return this.projectsService.findAll(user.id);
    }
    findOne(id, user) {
        return this.projectsService.findOne(id, user.id);
    }
    async create(user, dto) {
        const project = await this.projectsService.create(user.id, dto);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.CREATE,
            resource: 'project',
            resourceId: project?.id,
            metadata: { name: dto.name, baseUrl: dto.baseUrl },
        });
        return project;
    }
    createDraft(user, dto) {
        return this.projectsService.createDraft(user.id, dto);
    }
    saveDraft(id, user, dto) {
        return this.projectsService.saveDraft(id, user.id, dto);
    }
    finalize(id, user) {
        return this.projectsService.finalize(id, user.id);
    }
    async update(id, user, dto) {
        const project = await this.projectsService.update(id, user.id, dto);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.UPDATE,
            resource: 'project',
            resourceId: id,
            metadata: { fields: Object.keys(dto ?? {}) },
        });
        return project;
    }
    async remove(id, user) {
        const result = await this.projectsService.remove(id, user.id);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.DELETE,
            resource: 'project',
            resourceId: id,
        });
        return result;
    }
    async importFromUrl(id, user, url) {
        const result = await this.projectsService.importOpenApiFromUrl(id, user.id, url);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.IMPORT,
            resource: 'project.spec',
            resourceId: id,
            metadata: { source: 'url', url },
        });
        return result;
    }
    async importFromUpload(id, user, spec) {
        const result = await this.projectsService.importOpenApiFromContent(id, user.id, spec);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.IMPORT,
            resource: 'project.spec',
            resourceId: id,
            metadata: { source: 'upload' },
        });
        return result;
    }
    async saveAuth(id, user, authData) {
        const result = await this.projectsService.saveAuthConfig(id, user.id, authData);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.UPDATE,
            resource: 'project.authConfig',
            resourceId: id,
            metadata: { type: authData?.type ?? 'NONE' },
        });
        return result;
    }
};
exports.ProjectsController = ProjectsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all projects' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProjectsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get project details' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProjectsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new project' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_project_dto_1.CreateProjectDto]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('drafts'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a meaningful project draft' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_project_dto_1.SaveProjectDraftDto]),
    __metadata("design:returntype", void 0)
], ProjectsController.prototype, "createDraft", null);
__decorate([
    (0, common_1.Put)(':id/draft'),
    (0, swagger_1.ApiOperation)({ summary: 'Autosave a project draft' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, create_project_dto_1.SaveProjectDraftDto]),
    __metadata("design:returntype", void 0)
], ProjectsController.prototype, "saveDraft", null);
__decorate([
    (0, common_1.Post)(':id/finalize'),
    (0, swagger_1.ApiOperation)({ summary: 'Validate and finalize a project draft' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProjectsController.prototype, "finalize", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a project' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, create_project_dto_1.UpdateProjectDto]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a project' }),
    openapi.ApiResponse({ status: common_1.HttpStatus.NO_CONTENT }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/spec/url'),
    (0, swagger_1.ApiOperation)({ summary: 'Import OpenAPI spec from URL' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)('url')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "importFromUrl", null);
__decorate([
    (0, common_1.Post)(':id/spec/upload'),
    (0, swagger_1.ApiOperation)({ summary: 'Import OpenAPI spec from uploaded content' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)('spec')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "importFromUpload", null);
__decorate([
    (0, common_1.Post)(':id/auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Save authentication configuration' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ProjectsController.prototype, "saveAuth", null);
exports.ProjectsController = ProjectsController = __decorate([
    (0, swagger_1.ApiTags)('Projects'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('projects'),
    __metadata("design:paramtypes", [projects_service_1.ProjectsService,
        audit_service_1.AuditService])
], ProjectsController);
//# sourceMappingURL=projects.controller.js.map