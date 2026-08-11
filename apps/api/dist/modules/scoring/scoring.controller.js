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
exports.ScoringController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const prisma_service_1 = require("../../prisma/prisma.service");
const scoring_service_1 = require("./scoring.service");
const comparison_service_1 = require("./comparison.service");
let ScoringController = class ScoringController {
    constructor(scoring, comparison, prisma) {
        this.scoring = scoring;
        this.comparison = comparison;
        this.prisma = prisma;
    }
    getAssessmentScore(id, user) {
        return this.scoring.getAssessmentScore(id, user.id);
    }
    async getProjectPosture(id, user) {
        const project = await this.prisma.project.findFirst({
            where: { id, userId: user.id, isActive: true },
            select: { id: true },
        });
        if (!project)
            throw new common_1.NotFoundException('Project not found');
        return this.scoring.getProjectPosture(id);
    }
    compare(id, user, baseline) {
        return this.comparison.compare(id, user.id, baseline);
    }
    candidates(id, user) {
        return this.comparison.getComparisonCandidates(id, user.id);
    }
};
exports.ScoringController = ScoringController;
__decorate([
    (0, common_1.Get)('assessments/:id/score'),
    (0, swagger_1.ApiOperation)({ summary: 'Score snapshot and explanation for a scan' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ScoringController.prototype, "getAssessmentScore", null);
__decorate([
    (0, common_1.Get)('projects/:id/posture'),
    (0, swagger_1.ApiOperation)({ summary: 'Current security posture of a project' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ScoringController.prototype, "getProjectPosture", null);
__decorate([
    (0, common_1.Get)('assessments/:id/comparison'),
    (0, swagger_1.ApiOperation)({ summary: 'Compare a scan against a baseline' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('baseline')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", void 0)
], ScoringController.prototype, "compare", null);
__decorate([
    (0, common_1.Get)('assessments/:id/comparison/candidates'),
    (0, swagger_1.ApiOperation)({ summary: 'Scans that can serve as a comparison baseline' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ScoringController.prototype, "candidates", null);
exports.ScoringController = ScoringController = __decorate([
    (0, swagger_1.ApiTags)('Scoring'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [scoring_service_1.ScoringService,
        comparison_service_1.ComparisonService,
        prisma_service_1.PrismaService])
], ScoringController);
//# sourceMappingURL=scoring.controller.js.map