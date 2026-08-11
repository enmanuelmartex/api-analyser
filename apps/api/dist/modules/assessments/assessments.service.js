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
var AssessmentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssessmentsService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const event_emitter_1 = require("@nestjs/event-emitter");
const rxjs_1 = require("rxjs");
const prisma_service_1 = require("../../prisma/prisma.service");
const plugin_registry_service_1 = require("../plugins/plugin-registry.service");
const scoring_service_1 = require("../scoring/scoring.service");
const assessment_finding_counts_1 = require("./assessment-finding-counts");
const PROJECT_ASSESSMENTS_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
let AssessmentsService = AssessmentsService_1 = class AssessmentsService {
    constructor(prisma, scannerQueue, eventEmitter, pluginRegistry, scoring) {
        this.prisma = prisma;
        this.scannerQueue = scannerQueue;
        this.eventEmitter = eventEmitter;
        this.pluginRegistry = pluginRegistry;
        this.scoring = scoring;
        this.logger = new common_1.Logger(AssessmentsService_1.name);
        this.progressSubjects = new Map();
        this.eventEmitter.on('scanner.progress', (data) => {
            this.emitProgress(data.assessmentId, data);
        });
    }
    async findAll(userId, projectId) {
        const assessments = await this.prisma.assessment.findMany({
            where: {
                project: { userId },
                ...(projectId ? { projectId } : {}),
            },
            include: {
                project: { select: { id: true, name: true, baseUrl: true } },
                summary: true,
                _count: { select: { occurrences: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        return this.withFindingCounts(assessments);
    }
    async findByProjectPaginated(userId, projectId, page = 1, pageSize = PROJECT_ASSESSMENTS_PAGE_SIZE) {
        const safePage = Math.max(1, Math.floor(page) || 1);
        const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || PROJECT_ASSESSMENTS_PAGE_SIZE));
        const where = { projectId, project: { userId } };
        const [total, rows] = await Promise.all([
            this.prisma.assessment.count({ where }),
            this.prisma.assessment.findMany({
                where,
                include: {
                    project: { select: { id: true, name: true, baseUrl: true } },
                    summary: true,
                    _count: { select: { occurrences: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (safePage - 1) * safeSize,
                take: safeSize,
            }),
        ]);
        return {
            data: await this.withFindingCounts(rows),
            page: safePage,
            pageSize: safeSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / safeSize)),
        };
    }
    async withFindingCounts(assessments) {
        const counts = await this.findingCountsFor(assessments.map((a) => a.id));
        return assessments.map((assessment) => ({
            ...assessment,
            findingCounts: counts.get(assessment.id) ?? (0, assessment_finding_counts_1.emptyFindingCounts)(),
        }));
    }
    async findingCountsFor(assessmentIds) {
        if (!assessmentIds.length)
            return new Map();
        const groups = await this.prisma.findingOccurrence.groupBy({
            by: ['assessmentId', 'severitySnapshot'],
            where: { assessmentId: { in: assessmentIds } },
            _count: { _all: true },
        });
        return (0, assessment_finding_counts_1.foldOccurrenceCounts)(groups);
    }
    async findOne(id, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id, project: { userId } },
            include: {
                project: { select: { id: true, name: true, baseUrl: true, environment: true } },
                config: true,
                summary: true,
                occurrences: {
                    orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
                    include: {
                        issue: {
                            select: {
                                id: true,
                                status: true,
                                firstSeenAt: true,
                                lastSeenAt: true,
                                occurrenceCount: true,
                                reopenCount: true,
                            },
                        },
                    },
                },
                reports: true,
                logs: {
                    orderBy: { timestamp: 'asc' },
                    take: 500,
                },
            },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        const findingCounts = (0, assessment_finding_counts_1.countOccurrenceSeverities)(assessment.occurrences);
        return {
            ...assessment,
            findingCounts,
            summary: assessment.summary
                ? { ...assessment.summary, ...(0, assessment_finding_counts_1.findingSummaryFields)(findingCounts) }
                : assessment.summary,
        };
    }
    async createAndRun(projectId, userId, config = {}) {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, userId },
            include: {
                apiSpec: {
                    include: { authConfig: true, endpoints: true },
                },
            },
        });
        if (!project)
            throw new common_1.ForbiddenException('Project not found or access denied');
        if (project.status !== 'READY') {
            throw new common_1.BadRequestException('Complete project setup before running an assessment');
        }
        if (!project.apiSpec) {
            throw new common_1.BadRequestException('Please import an OpenAPI specification before running an assessment');
        }
        if (!project.apiSpec.endpoints.length) {
            throw new common_1.BadRequestException('No endpoints found in the API specification');
        }
        const executionMode = config.executionMode ?? 'all';
        const enabledPlugins = await this.pluginRegistry.getEnabledForUser(userId);
        const enabledIds = new Set(enabledPlugins.map((plugin) => plugin.manifest.id));
        let profileId = null;
        let requestedIds;
        if (executionMode === 'profile') {
            if (!config.scanProfileId)
                throw new common_1.BadRequestException('Select a scan profile');
            const profile = await this.prisma.scanProfile.findFirst({
                where: {
                    id: config.scanProfileId,
                    OR: [{ isSystem: true }, { userId }],
                },
            });
            if (!profile)
                throw new common_1.BadRequestException('The selected scan profile is not available');
            if (!profile.enabledPlugins.length)
                throw new common_1.BadRequestException('The selected scan profile has no plugins');
            profileId = profile.id;
            requestedIds = profile.enabledPlugins;
        }
        else if (executionMode === 'manual') {
            requestedIds = [...new Set(config.manualPlugins ?? [])];
            if (!requestedIds.length)
                throw new common_1.BadRequestException('Select at least one plugin');
        }
        else {
            requestedIds = [...enabledIds];
        }
        const unknownIds = requestedIds.filter((id) => !this.pluginRegistry.has(id));
        if (unknownIds.length)
            throw new common_1.BadRequestException('One or more selected plugins are not available');
        const resolvedPlugins = requestedIds.filter((id) => enabledIds.has(id));
        if (!resolvedPlugins.length) {
            throw new common_1.BadRequestException(executionMode === 'all'
                ? 'Enable at least one plugin before running an assessment'
                : 'None of the selected plugins are currently enabled');
        }
        const assessment = await this.prisma.assessment.create({
            data: {
                projectId,
                status: 'QUEUED',
                config: {
                    create: {
                        executionMode,
                        scanProfileId: profileId,
                        manualPlugins: executionMode === 'manual' ? requestedIds : [],
                        resolvedPlugins,
                        enableAiAnalysis: config.enableAiAnalysis ?? true,
                        maxRequestsPerEndpoint: config.maxRequestsPerEndpoint ?? 10,
                        requestDelayMs: config.requestDelayMs ?? 200,
                        timeoutMs: config.timeoutMs ?? 10000,
                    },
                },
            },
            include: { config: true },
        });
        const job = await this.scannerQueue.add('run-assessment', {
            assessmentId: assessment.id,
            projectId,
            specId: project.apiSpec.id,
            userId,
        }, { jobId: `assessment-${assessment.id}` });
        await this.prisma.assessment.update({
            where: { id: assessment.id },
            data: { jobId: job.id, status: 'QUEUED' },
        });
        this.logger.log(`Assessment ${assessment.id} queued (job: ${job.id})`);
        return assessment;
    }
    async cancel(id, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id, project: { userId } },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        if (assessment.jobId) {
            const job = await this.scannerQueue.getJob(assessment.jobId);
            await job?.remove();
        }
        return this.prisma.assessment.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });
    }
    async streamProgress(assessmentId, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { id: true, status: true, progress: true, currentStep: true },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        const subject = new rxjs_1.Subject();
        this.progressSubjects.set(assessmentId, subject);
        setTimeout(() => {
            if (this.progressSubjects.has(assessmentId)) {
                this.progressSubjects.get(assessmentId)?.complete();
                this.progressSubjects.delete(assessmentId);
            }
        }, 10 * 60 * 1000);
        const initial = {
            data: {
                assessmentId,
                step: assessment.currentStep ?? assessment.status,
                message: assessment.currentStep ?? assessment.status,
                progress: assessment.progress,
                completed: assessment.status === 'COMPLETED',
                error: assessment.status === 'FAILED' ? assessment.currentStep ?? 'Assessment failed' : undefined,
            },
        };
        return (0, rxjs_1.concat)((0, rxjs_1.of)(initial), subject.asObservable());
    }
    emitProgress(assessmentId, data) {
        const subject = this.progressSubjects.get(assessmentId);
        if (subject) {
            subject.next({ data });
        }
    }
    async getDashboardStats(userId) {
        const [projects, totalAssessmentCount, assessments, findings] = await Promise.all([
            this.prisma.project.count({ where: { userId, isActive: true } }),
            this.prisma.assessment.count({ where: { project: { userId } } }),
            this.prisma.assessment.findMany({
                where: { project: { userId }, status: 'COMPLETED' },
                include: { summary: true },
                orderBy: { createdAt: 'desc' },
                take: 10,
            }),
            this.prisma.securityIssue.groupBy({
                by: ['severity'],
                where: {
                    project: { userId, isActive: true },
                    status: { in: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK'] },
                },
                _count: { severity: true },
            }),
        ]);
        const findingsBySeverity = findings.reduce((acc, f) => {
            const key = f.severity.toLowerCase();
            acc[key] = (acc[key] || 0) + f._count.severity;
            return acc;
        }, {});
        const postures = await Promise.all((await this.prisma.project.findMany({
            where: { userId, isActive: true },
            select: { id: true },
        })).map((project) => this.scoring.getProjectPosture(project.id)));
        const scored = postures
            .map((posture) => posture.currentSecurityScore)
            .filter((score) => typeof score === 'number');
        return {
            totalProjects: projects,
            totalAssessments: totalAssessmentCount,
            avgSecurityScore: scored.length > 0
                ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
                : null,
            scoredProjects: scored.length,
            unassessedProjects: postures.length - scored.length,
            findings: findingsBySeverity,
            recentAssessments: await this.withFindingCounts(assessments.slice(0, 5)),
            ...(await this.getScoreTrend(userId)),
            ...(await this.getFindingsTrend(userId)),
        };
    }
    async getFindingsTrend(userId) {
        const WEEKS = 8;
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        const now = new Date();
        const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const windowStart = new Date(windowEnd.getTime() - WEEKS * WEEK_MS);
        const previousStart = new Date(windowEnd.getTime() - 2 * WEEKS * WEEK_MS);
        const occurrences = await this.prisma.findingOccurrence.findMany({
            where: {
                issue: { project: { userId, isActive: true } },
                detectedAt: { gte: previousStart, lt: windowEnd },
            },
            select: { detectedAt: true, severitySnapshot: true },
        });
        const weeks = Array.from({ length: WEEKS }, (_, index) => ({
            weekStart: new Date(windowStart.getTime() + index * WEEK_MS).toISOString(),
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
        }));
        let findingsTrendPreviousTotal = 0;
        for (const occurrence of occurrences) {
            const time = new Date(occurrence.detectedAt).getTime();
            if (time < windowStart.getTime()) {
                findingsTrendPreviousTotal += 1;
                continue;
            }
            const index = Math.floor((time - windowStart.getTime()) / WEEK_MS);
            if (index < 0 || index >= WEEKS)
                continue;
            const key = occurrence.severitySnapshot.toLowerCase();
            if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low' || key === 'info') {
                weeks[index][key] += 1;
            }
        }
        return { findingsTrend: weeks, findingsTrendPreviousTotal };
    }
    async getScoreTrend(userId) {
        const now = new Date();
        const year = now.getFullYear();
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);
        const months = Array.from({ length: 12 }, (_, monthIndex) => ({
            key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
            scoreSum: 0,
            scoreCount: 0,
            completedCount: 0,
        }));
        const completed = await this.prisma.assessment.findMany({
            where: {
                project: { userId },
                status: 'COMPLETED',
                completedAt: { gte: yearStart, lt: yearEnd },
            },
            select: { completedAt: true, summary: { select: { securityScore: true } } },
        });
        let yearScoreSum = 0;
        let yearScoreCount = 0;
        for (const assessment of completed) {
            if (!assessment.completedAt)
                continue;
            const bucket = months[new Date(assessment.completedAt).getMonth()];
            if (!bucket)
                continue;
            bucket.completedCount += 1;
            const score = assessment.summary?.securityScore;
            if (typeof score === 'number') {
                bucket.scoreSum += score;
                bucket.scoreCount += 1;
                yearScoreSum += score;
                yearScoreCount += 1;
            }
        }
        return {
            scoreTrend: months.map((month) => ({
                month: month.key,
                averageScore: month.scoreCount > 0 ? Math.round(month.scoreSum / month.scoreCount) : null,
                completedCount: month.completedCount,
            })),
            scoreTrendAverage: yearScoreCount > 0 ? Math.round(yearScoreSum / yearScoreCount) : null,
        };
    }
};
exports.AssessmentsService = AssessmentsService;
exports.AssessmentsService = AssessmentsService = AssessmentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, bullmq_1.InjectQueue)('scanner')),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        bullmq_2.Queue,
        event_emitter_1.EventEmitter2,
        plugin_registry_service_1.PluginRegistryService,
        scoring_service_1.ScoringService])
], AssessmentsService);
//# sourceMappingURL=assessments.service.js.map