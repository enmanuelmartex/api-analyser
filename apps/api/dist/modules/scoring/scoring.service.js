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
var ScoringService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const score_engine_1 = require("./score-engine");
let ScoringService = ScoringService_1 = class ScoringService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(ScoringService_1.name);
    }
    async scoreAssessment(assessmentId) {
        const assessment = await this.prisma.assessment.findUnique({
            where: { id: assessmentId },
            select: {
                id: true,
                status: true,
                summary: {
                    select: {
                        plannedChecks: true,
                        successfulChecks: true,
                        failedChecks: true,
                        skippedChecks: true,
                        executionErrors: true,
                    },
                },
            },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        const issues = await this.loadScorableIssues(assessmentId);
        const result = (0, score_engine_1.computeScore)({
            assessmentStatus: assessment.status,
            issues,
            coverage: {
                plannedChecks: assessment.summary?.plannedChecks ?? 0,
                successfulChecks: assessment.summary?.successfulChecks ?? 0,
                failedChecks: assessment.summary?.failedChecks ?? 0,
                skippedChecks: assessment.summary?.skippedChecks ?? 0,
                executionErrors: assessment.summary?.executionErrors ?? 0,
            },
        });
        await this.prisma.assessmentSummary.update({
            where: { assessmentId },
            data: {
                securityScore: result.securityScore,
                scoreStatus: result.scoreStatus,
                scoreVersion: result.securityScore === null ? null : result.scoreVersion,
                scoreComputedAt: result.securityScore === null ? null : new Date(),
                coveragePercent: result.coveragePercent,
                scoreExplanation: result,
            },
        });
        return result;
    }
    async loadScorableIssues(assessmentId) {
        const occurrences = await this.prisma.findingOccurrence.findMany({
            where: { assessmentId },
            select: {
                severitySnapshot: true,
                pluginIdSnapshot: true,
                ruleIdSnapshot: true,
                methodSnapshot: true,
                pathSnapshot: true,
                location: true,
                issue: { select: { fingerprint: true } },
            },
        });
        return occurrences.map((occurrence) => ({
            fingerprint: occurrence.issue.fingerprint,
            pluginId: occurrence.pluginIdSnapshot,
            ruleId: occurrence.ruleIdSnapshot,
            severity: occurrence.severitySnapshot,
            method: occurrence.methodSnapshot,
            normalizedRoute: occurrence.pathSnapshot,
            component: occurrence.location,
        }));
    }
    async getProjectPosture(projectId) {
        const candidates = await this.prisma.assessment.findMany({
            where: { projectId, status: 'COMPLETED', summary: { isNot: null } },
            orderBy: { createdAt: 'desc' },
            take: 25,
            select: {
                id: true,
                createdAt: true,
                completedAt: true,
                summary: {
                    select: {
                        securityScore: true,
                        scoreStatus: true,
                        scoreVersion: true,
                        coveragePercent: true,
                        scoreComputedAt: true,
                        plannedChecks: true,
                        successfulChecks: true,
                        failedChecks: true,
                        skippedChecks: true,
                    },
                },
            },
        });
        const chosen = candidates.find((a) => a.summary?.scoreStatus === 'FINAL') ??
            candidates.find((a) => a.summary?.scoreStatus === 'PROVISIONAL') ??
            null;
        if (!chosen?.summary) {
            return {
                currentSecurityScore: null,
                currentScoreStatus: 'UNAVAILABLE',
                currentScoreVersion: null,
                currentCoveragePercent: null,
                scoredAt: null,
                assessmentId: null,
                reason: candidates.length === 0
                    ? 'This project has not been scanned yet.'
                    : 'No completed scan produced a score that could be computed.',
            };
        }
        return {
            currentSecurityScore: chosen.summary.securityScore,
            currentScoreStatus: chosen.summary.scoreStatus,
            currentScoreVersion: chosen.summary.scoreVersion,
            currentCoveragePercent: chosen.summary.coveragePercent,
            scoredAt: chosen.summary.scoreComputedAt ?? chosen.completedAt ?? chosen.createdAt,
            assessmentId: chosen.id,
            reason: chosen.summary.scoreStatus === 'PROVISIONAL'
                ? 'The most recent scan did not complete every planned check, so this score is provisional.'
                : null,
        };
    }
    async getAssessmentScore(assessmentId, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: {
                id: true,
                status: true,
                createdAt: true,
                completedAt: true,
                summary: true,
            },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Scan not found');
        const summary = assessment.summary;
        return {
            assessmentId: assessment.id,
            status: assessment.status,
            securityScore: summary?.securityScore ?? null,
            scoreStatus: summary?.scoreStatus ?? 'UNAVAILABLE',
            scoreVersion: summary?.scoreVersion ?? null,
            scoreComputedAt: summary?.scoreComputedAt ?? null,
            coveragePercent: summary?.coveragePercent ?? null,
            coverage: {
                plannedChecks: summary?.plannedChecks ?? 0,
                successfulChecks: summary?.successfulChecks ?? 0,
                failedChecks: summary?.failedChecks ?? 0,
                skippedChecks: summary?.skippedChecks ?? 0,
                executionErrors: summary?.executionErrors ?? 0,
            },
            explanation: summary?.scoreExplanation ?? null,
        };
    }
};
exports.ScoringService = ScoringService;
exports.ScoringService = ScoringService = ScoringService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ScoringService);
//# sourceMappingURL=scoring.service.js.map