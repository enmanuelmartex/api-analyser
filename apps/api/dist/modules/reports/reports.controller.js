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
exports.ReportsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const reports_service_1 = require("./reports.service");
const audit_service_1 = require("../audit/audit.service");
const report_artifact_1 = require("./report-artifact");
let ReportsController = class ReportsController {
    constructor(reportsService, audit) {
        this.reportsService = reportsService;
        this.audit = audit;
    }
    getStats(user) {
        return this.reportsService.getStats(user.id);
    }
    findAll(user, assessmentId, includeHistory) {
        return this.reportsService.findAll(user.id, {
            assessmentId,
            includeHistory: includeHistory === 'true',
        });
    }
    findByAssessment(assessmentId, user) {
        return this.reportsService.findByAssessment(assessmentId, user.id);
    }
    formats(assessmentId, user, type = 'TECHNICAL') {
        if (!(0, report_artifact_1.isReportType)(type))
            throw new common_1.BadRequestException(`Unsupported report type: ${type}`);
        return this.reportsService.findByAssessment(assessmentId, user.id).then(() => this.reportsService.formatAvailability(assessmentId, type));
    }
    async generate(assessmentId, user, body = {}) {
        const format = body.format ?? 'PDF';
        const type = body.type ?? 'TECHNICAL';
        if (!(0, report_artifact_1.isReportFormat)(format))
            throw new common_1.BadRequestException(`Unsupported report format: ${format}`);
        if (!(0, report_artifact_1.isReportType)(type))
            throw new common_1.BadRequestException(`Unsupported report type: ${type}`);
        const result = await this.reportsService.generate(assessmentId, user.id, {
            format: format,
            type: type,
            regenerate: body.regenerate === true,
        });
        if (result?.created) {
            this.audit.log({
                userId: user.id,
                action: client_1.AuditAction.CREATE,
                resource: 'report',
                resourceId: result.report?.id,
                metadata: {
                    assessmentId,
                    format,
                    type,
                    version: result.report?.version,
                    regenerated: body.regenerate === true,
                },
            });
        }
        return result;
    }
    async download(id, user, res) {
        const artifact = await this.reportsService.resolveArtifact(id, user.id);
        res.setHeader('Content-Type', artifact.contentType);
        res.setHeader('Content-Disposition', (0, report_artifact_1.contentDisposition)(artifact.fileName));
        res.setHeader('Content-Length', artifact.bytes.length);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(artifact.bytes);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.EXPORT,
            resource: 'report',
            resourceId: id,
            metadata: { fileName: artifact.fileName },
        });
    }
    findOne(id, user) {
        return this.reportsService.findOne(id, user.id);
    }
    async remove(id, user) {
        const result = await this.reportsService.remove(id, user.id);
        this.audit.log({
            userId: user.id,
            action: client_1.AuditAction.DELETE,
            resource: 'report',
            resourceId: id,
        });
        return result;
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('stats'),
    (0, swagger_1.ApiOperation)({ summary: 'Reports metrics and vulnerability trend' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List reports (latest version of each artifact)' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('assessmentId')),
    __param(2, (0, common_1.Query)('includeHistory')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('assessment/:assessmentId'),
    (0, swagger_1.ApiOperation)({ summary: 'List reports of one assessment' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, common_1.Param)('assessmentId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "findByAssessment", null);
__decorate([
    (0, common_1.Get)('assessment/:assessmentId/formats'),
    (0, swagger_1.ApiOperation)({ summary: 'Availability of every format for an assessment + report type' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, common_1.Param)('assessmentId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "formats", null);
__decorate([
    (0, common_1.Post)('assessment/:assessmentId/generate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Generate a report artifact for an assessment' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('assessmentId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)(':id/download'),
    (0, swagger_1.ApiOperation)({ summary: 'Download an existing report artifact' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "download", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get report details' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a report and its artifact' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "remove", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)('Reports'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('reports'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService,
        audit_service_1.AuditService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map