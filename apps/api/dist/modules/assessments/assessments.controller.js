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
exports.AssessmentsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const assessments_service_1 = require("./assessments.service");
const run_assessment_dto_1 = require("./dto/run-assessment.dto");
const audit_service_1 = require("../audit/audit.service");
let AssessmentsController = class AssessmentsController {
    constructor(assessmentsService, audit) {
        this.assessmentsService = assessmentsService;
        this.audit = audit;
    }
    findAll(user, projectId) {
        return this.assessmentsService.findAll(user.id, projectId);
    }
    getDashboard(user) {
        return this.assessmentsService.getDashboardStats(user.id);
    }
    findByProject(projectId, user, page, pageSize) {
        return this.assessmentsService.findByProjectPaginated(user.id, projectId, page ? Number.parseInt(page, 10) : undefined, pageSize ? Number.parseInt(pageSize, 10) : undefined);
    }
    findOne(id, user) {
        return this.assessmentsService.findOne(id, user.id);
    }
    async createAndRun(projectId, user, config) {
        const assessment = await this.assessmentsService.createAndRun(projectId, user.id, config);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.SCAN_START,
            resource: 'assessment',
            resourceId: assessment?.id,
            metadata: {
                projectId,
                executionMode: config?.executionMode ?? 'all',
                scanProfileId: config?.scanProfileId,
            },
        });
        return assessment;
    }
    async cancel(id, user) {
        const result = await this.assessmentsService.cancel(id, user.id);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.SCAN_STOP,
            resource: 'assessment',
            resourceId: id,
        });
        return result;
    }
    async streamProgress(id, user) {
        return this.assessmentsService.streamProgress(id, user.id);
    }
};
exports.AssessmentsController = AssessmentsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List assessments' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get dashboard statistics' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "getDashboard", null);
__decorate([
    (0, common_1.Get)('projects/:projectId'),
    (0, swagger_1.ApiOperation)({ summary: "List a project's assessments (paginated, newest first)" }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "findByProject", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get assessment details' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)('projects/:projectId/run'),
    (0, swagger_1.ApiOperation)({ summary: 'Create and run a new assessment' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, run_assessment_dto_1.RunAssessmentDto]),
    __metadata("design:returntype", Promise)
], AssessmentsController.prototype, "createAndRun", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Cancel a running assessment' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AssessmentsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Sse)(':id/progress'),
    (0, swagger_1.ApiOperation)({ summary: 'Stream assessment progress via SSE' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AssessmentsController.prototype, "streamProgress", null);
exports.AssessmentsController = AssessmentsController = __decorate([
    (0, swagger_1.ApiTags)('Assessments'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('assessments'),
    __metadata("design:paramtypes", [assessments_service_1.AssessmentsService,
        audit_service_1.AuditService])
], AssessmentsController);
//# sourceMappingURL=assessments.controller.js.map