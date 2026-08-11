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
exports.IssuesController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const issues_service_1 = require("./issues.service");
const issue_dto_1 = require("./dto/issue.dto");
const audit_service_1 = require("../audit/audit.service");
let IssuesController = class IssuesController {
    constructor(issues, audit) {
        this.issues = issues;
        this.audit = audit;
    }
    findAll(user, query) {
        return this.issues.findAll(user.id, query);
    }
    getStats(user, projectId) {
        return this.issues.getStats(user.id, projectId);
    }
    findOccurrences(assessmentId, user) {
        return this.issues.findOccurrencesByAssessment(assessmentId, user.id);
    }
    getGuidance(id, user) {
        return this.issues.getGuidance(id, user.id);
    }
    findOne(id, user) {
        return this.issues.findOne(id, user.id);
    }
    async updateStatus(id, user, dto) {
        const issue = await this.issues.updateStatus(id, user.id, dto);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.UPDATE,
            resource: 'issue',
            resourceId: id,
            metadata: {
                toStatus: dto.status,
                hasJustification: Boolean(dto.reason),
                acceptedRiskUntil: dto.acceptedRiskUntil ?? null,
            },
        });
        return issue;
    }
    async assign(id, user, dto) {
        const issue = await this.issues.assign(id, user.id, dto.assigneeId ?? null);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.UPDATE,
            resource: 'issue',
            resourceId: id,
            metadata: { assigneeId: dto.assigneeId ?? null },
        });
        return issue;
    }
};
exports.IssuesController = IssuesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List persistent issues (deduplicated, paginated)' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, issue_dto_1.IssueQueryDto]),
    __metadata("design:returntype", void 0)
], IssuesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, swagger_1.ApiOperation)({ summary: 'Aggregate counts over current issues' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], IssuesController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)('occurrences/assessment/:assessmentId'),
    (0, swagger_1.ApiOperation)({ summary: 'Detections produced by one scan' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, common_1.Param)('assessmentId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], IssuesController.prototype, "findOccurrences", null);
__decorate([
    (0, common_1.Get)(':id/guidance'),
    (0, swagger_1.ApiOperation)({ summary: 'AI security guidance for an issue' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], IssuesController.prototype, "getGuidance", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Issue detail with occurrence history and triage timeline' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], IssuesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Apply a triage decision' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, issue_dto_1.UpdateIssueStatusDto]),
    __metadata("design:returntype", Promise)
], IssuesController.prototype, "updateStatus", null);
__decorate([
    (0, common_1.Patch)(':id/assignee'),
    (0, swagger_1.ApiOperation)({ summary: 'Assign or unassign an issue' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, issue_dto_1.AssignIssueDto]),
    __metadata("design:returntype", Promise)
], IssuesController.prototype, "assign", null);
exports.IssuesController = IssuesController = __decorate([
    (0, swagger_1.ApiTags)('Issues'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('issues'),
    __metadata("design:paramtypes", [issues_service_1.IssuesService,
        audit_service_1.AuditService])
], IssuesController);
//# sourceMappingURL=issues.controller.js.map