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
var ReportsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const report_generator_service_1 = require("./report-generator.service");
const report_storage_service_1 = require("./report-storage.service");
const report_artifact_1 = require("./report-artifact");
const report_metrics_1 = require("./report-metrics");
const assessment_finding_counts_1 = require("../assessments/assessment-finding-counts");
const UNIQUE_VIOLATION = 'P2002';
const TREND_WINDOW_DAYS = 30;
let ReportsService = ReportsService_1 = class ReportsService {
    constructor(prisma, generator, storage) {
        this.prisma = prisma;
        this.generator = generator;
        this.storage = storage;
        this.logger = new common_1.Logger(ReportsService_1.name);
    }
    async findAll(userId, options = {}) {
        const reports = await this.prisma.report.findMany({
            where: {
                assessment: { project: { userId } },
                ...(options.assessmentId ? { assessmentId: options.assessmentId } : {}),
            },
            include: {
                assessment: {
                    select: {
                        id: true,
                        completedAt: true,
                        project: { select: { id: true, name: true } },
                    },
                },
            },
            orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        });
        const visible = options.includeHistory ? reports : this.latestVersionsOnly(reports);
        return visible.map((report) => this.withArtifactState(report));
    }
    latestVersionsOnly(reports) {
        const latest = new Map();
        for (const report of reports) {
            const key = `${report.assessmentId}:${report.type}:${report.format}`;
            const held = latest.get(key);
            if (!held || report.version > held.version)
                latest.set(key, report);
        }
        return reports.filter((report) => latest.get(`${report.assessmentId}:${report.type}:${report.format}`) === report);
    }
    async findOne(id, userId) {
        const report = await this.prisma.report.findFirst({
            where: { id, assessment: { project: { userId } } },
            include: {
                assessment: {
                    select: {
                        id: true,
                        status: true,
                        completedAt: true,
                        duration: true,
                        project: { select: { id: true, name: true } },
                        summary: true,
                        occurrences: {
                            orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
                            include: { issue: { select: { id: true, status: true } } },
                        },
                    },
                },
            },
        });
        if (!report)
            throw new common_1.NotFoundException('Report not found');
        const findingCounts = (0, assessment_finding_counts_1.countOccurrenceSeverities)(report.assessment.occurrences);
        const assessment = {
            ...report.assessment,
            findingCounts,
            summary: report.assessment.summary
                ? { ...report.assessment.summary, ...(0, assessment_finding_counts_1.findingSummaryFields)(findingCounts) }
                : report.assessment.summary,
        };
        return {
            ...this.withArtifactState(report),
            assessment,
            formats: await this.formatAvailability(report.assessmentId, report.type),
        };
    }
    async findByAssessment(assessmentId, userId) {
        await this.assertAssessmentAccess(assessmentId, userId);
        return this.findAll(userId, { assessmentId });
    }
    async formatAvailability(assessmentId, type) {
        const existing = await this.prisma.report.findMany({
            where: { assessmentId, type: type },
            orderBy: { version: 'desc' },
        });
        return report_artifact_1.REPORT_FORMATS.map((format) => {
            const report = existing.find((candidate) => candidate.format === format);
            if (!report) {
                return { format, status: 'MISSING', reportId: null, fileSize: null, generatedAt: null, version: null };
            }
            const state = this.artifactState(report);
            return {
                format,
                status: state === 'READY' ? 'AVAILABLE' : 'UNAVAILABLE',
                reportId: report.id,
                fileSize: report.fileSize,
                generatedAt: report.generatedAt,
                version: report.version,
            };
        });
    }
    artifactState(report) {
        return report.filePath || report.sourceSnapshot ? 'READY' : 'EMPTY';
    }
    withArtifactState(report) {
        const { sourceSnapshot, ...rest } = report;
        return {
            ...rest,
            isDownloadable: this.artifactState(report) === 'READY',
        };
    }
    async generate(assessmentId, userId, options) {
        const { type, format, regenerate = false } = options;
        if (!regenerate) {
            const existing = await this.prisma.report.findFirst({
                where: { assessmentId, type: type, format: format, assessment: { project: { userId } } },
                orderBy: { version: 'desc' },
            });
            if (existing && this.artifactState(existing) === 'READY') {
                return { report: this.withArtifactState(existing), created: false };
            }
            if (existing) {
                const filled = await this.renderInto(existing.id, assessmentId, userId, type, format);
                return { report: filled, created: false };
            }
        }
        const assessment = await this.generator.getAssessmentData(assessmentId, userId);
        const projectName = assessment.project?.name ?? 'Report';
        const generatedAt = new Date();
        const nextVersion = regenerate
            ? ((await this.prisma.report.aggregate({
                where: { assessmentId, type: type, format: format },
                _max: { version: true },
            }))._max.version ?? 0) + 1
            : 1;
        const snapshot = this.renderSnapshot(assessment, type, format, { version: nextVersion });
        let report;
        try {
            report = await this.prisma.report.create({
                data: {
                    assessmentId,
                    type: type,
                    format: format,
                    version: nextVersion,
                    title: this.buildTitle(projectName, type, generatedAt, nextVersion),
                    sourceSnapshot: snapshot,
                    generatorVersion: report_artifact_1.GENERATOR_VERSION,
                    generatedAt,
                },
            });
        }
        catch (error) {
            if (error?.code === UNIQUE_VIOLATION) {
                const winner = await this.prisma.report.findFirst({
                    where: { assessmentId, type: type, format: format, version: nextVersion },
                });
                if (winner)
                    return { report: this.withArtifactState(winner), created: false };
            }
            throw error;
        }
        const materialised = await this.materialise(report, projectName, snapshot);
        return { report: this.withArtifactState(materialised), created: true };
    }
    async renderInto(reportId, assessmentId, userId, type, format) {
        const assessment = await this.generator.getAssessmentData(assessmentId, userId);
        const projectName = assessment.project?.name ?? 'Report';
        const report = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
        const snapshot = this.renderSnapshot(assessment, type, format, {
            reportId: report.id,
            version: report.version,
        });
        const materialised = await this.materialise(report, projectName, snapshot);
        return this.withArtifactState(materialised);
    }
    renderSnapshot(assessment, type, format, identity = {}) {
        switch (format) {
            case 'JSON':
                return this.generator.generateJson(assessment);
            case 'MARKDOWN':
                return this.generator.generateMarkdown(assessment);
            case 'SARIF':
                return this.generator.generateSarif(assessment);
            case 'PDF':
            case 'HTML':
            default:
                return this.generator.generateHtml(assessment, type, identity);
        }
    }
    async materialise(report, projectName, snapshot) {
        const format = report.format;
        const fileName = (0, report_artifact_1.buildFileName)({
            projectName,
            type: report.type,
            format,
            generatedAt: report.generatedAt,
            version: report.version,
        });
        let filePath = null;
        let fileSize = Buffer.byteLength(snapshot, 'utf8');
        let checksum = report_storage_service_1.ReportStorageService.checksum(snapshot);
        if ((0, report_artifact_1.isBinaryFormat)(format)) {
            try {
                const bytes = await this.generator.renderPdfFromHtml(snapshot);
                filePath = await this.storage.write((0, report_artifact_1.buildStoredFileName)(report.id, format), bytes);
                fileSize = bytes.length;
                checksum = report_storage_service_1.ReportStorageService.checksum(bytes);
            }
            catch (error) {
                this.logger.warn(`PDF render failed for report ${report.id}; the HTML snapshot was kept and the PDF will be produced on download. ${error.message}`);
            }
        }
        return this.prisma.report.update({
            where: { id: report.id },
            data: {
                fileName,
                filePath,
                fileSize,
                checksum,
                sourceSnapshot: snapshot,
                generatorVersion: report_artifact_1.GENERATOR_VERSION,
            },
        });
    }
    buildTitle(projectName, type, generatedAt, version) {
        const label = type.charAt(0) + type.slice(1).toLowerCase();
        const date = generatedAt.toISOString().split('T')[0];
        const revision = version > 1 ? ` (v${version})` : '';
        return `${label} report — ${projectName} — ${date}${revision}`;
    }
    async resolveArtifact(reportId, userId) {
        const report = await this.prisma.report.findFirst({
            where: { id: reportId, assessment: { project: { userId } } },
            include: { assessment: { select: { project: { select: { name: true } } } } },
        });
        if (!report)
            throw new common_1.NotFoundException('Report not found');
        const format = report.format;
        const fileName = report.fileName ??
            (0, report_artifact_1.buildFileName)({
                projectName: report.assessment?.project?.name ?? 'report',
                type: report.type,
                format,
                generatedAt: report.generatedAt,
                version: report.version,
            });
        if (report.filePath) {
            const bytes = await this.storage.read(report.filePath);
            if (bytes && (!report.checksum || report_storage_service_1.ReportStorageService.checksum(bytes) === report.checksum)) {
                return { bytes, contentType: (0, report_artifact_1.contentTypeFor)(format), fileName, rehydrated: false };
            }
            this.logger.warn(`Stored artifact for report ${reportId} is missing or altered; re-rendering from its snapshot.`);
        }
        if (!report.sourceSnapshot) {
            throw new common_1.UnprocessableEntityException('This report has no stored artifact. Regenerate it to produce a downloadable file.');
        }
        if (!(0, report_artifact_1.isBinaryFormat)(format)) {
            return {
                bytes: Buffer.from(report.sourceSnapshot, 'utf8'),
                contentType: (0, report_artifact_1.contentTypeFor)(format),
                fileName,
                rehydrated: true,
            };
        }
        let bytes;
        try {
            bytes = await this.generator.renderPdfFromHtml(report.sourceSnapshot);
        }
        catch (error) {
            this.logger.error(`Could not re-render PDF for report ${report.id}: ${error.message}`);
            throw new common_1.ServiceUnavailableException('This PDF could not be rebuilt because no PDF renderer is available on the server. ' +
                'Install Chromium or set CHROMIUM_EXECUTABLE_PATH, or download this report in another format.');
        }
        await this.storage
            .write((0, report_artifact_1.buildStoredFileName)(report.id, format), bytes)
            .then((stored) => stored
            ? this.prisma.report.update({
                where: { id: report.id },
                data: { filePath: stored, fileSize: bytes.length, checksum: report_storage_service_1.ReportStorageService.checksum(bytes) },
            })
            : null)
            .catch(() => null);
        return { bytes, contentType: (0, report_artifact_1.contentTypeFor)(format), fileName, rehydrated: true };
    }
    async getStats(userId) {
        const [reportRows, projects, completedAssessments] = await Promise.all([
            this.prisma.report.findMany({
                where: { assessment: { project: { userId } } },
                select: {
                    id: true,
                    assessmentId: true,
                    type: true,
                    format: true,
                    version: true,
                    generatedAt: true,
                },
            }),
            this.prisma.project.count({ where: { userId, isActive: true } }),
            this.prisma.assessment.findMany({
                where: { project: { userId }, status: 'COMPLETED' },
                select: {
                    id: true,
                    projectId: true,
                    completedAt: true,
                    createdAt: true,
                    summary: { select: { securityScore: true } },
                },
            }),
        ]);
        const latestReports = this.latestVersionsOnly(reportRows);
        const reportedIds = new Set(latestReports.map((report) => report.assessmentId));
        const occurrenceGroups = reportedIds.size
            ? await this.prisma.findingOccurrence.groupBy({
                by: ['assessmentId', 'severitySnapshot'],
                where: { assessmentId: { in: [...reportedIds] } },
                _count: { _all: true },
            })
            : [];
        const countsByAssessment = new Map();
        for (const group of occurrenceGroups) {
            const counts = countsByAssessment.get(group.assessmentId) ??
                { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
            const n = group._count._all;
            counts.total += n;
            const bucket = group.severitySnapshot.toLowerCase();
            if (bucket in counts && bucket !== 'total')
                counts[bucket] += n;
            countsByAssessment.set(group.assessmentId, counts);
        }
        const reported = completedAssessments
            .filter((assessment) => reportedIds.has(assessment.id))
            .map((assessment) => {
            const counts = countsByAssessment.get(assessment.id) ?? {
                critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0,
            };
            return {
                id: assessment.id,
                projectId: assessment.projectId,
                completedAt: assessment.completedAt ?? assessment.createdAt,
                securityScore: assessment.summary?.securityScore ?? null,
                ...counts,
            };
        });
        const severities = (0, report_metrics_1.sumSeverities)(reported);
        const { avgSecurityScore, scoredAssessments } = (0, report_metrics_1.averageScore)(reported);
        const trend = (0, report_metrics_1.buildTrend)(reported, TREND_WINDOW_DAYS);
        const windowStart = new Date();
        windowStart.setDate(windowStart.getDate() - TREND_WINDOW_DAYS);
        return {
            activeReportArtifacts: latestReports.length,
            supersededReportArtifacts: reportRows.length - latestReports.length,
            activeArtifactsLast30Days: latestReports.filter((r) => r.generatedAt >= windowStart).length,
            distinctAssessmentsWithReports: reported.length,
            totalCompletedAssessments: completedAssessments.length,
            distinctProjectsCovered: new Set(reported.map((a) => a.projectId)).size,
            totalActiveProjects: projects,
            averageAssessmentScore: avgSecurityScore,
            scoredAssessmentsInAverage: scoredAssessments,
            averageScoreDelta: (0, report_metrics_1.averageScoreDelta)(reported, TREND_WINDOW_DAYS),
            criticalFindingsIncluded: severities.criticalCount,
            highFindingsIncluded: severities.highCount,
            mediumFindingsIncluded: severities.mediumCount,
            lowFindingsIncluded: severities.lowCount,
            infoFindingsIncluded: severities.infoCount,
            totalFindingsIncluded: severities.totalFindings,
            criticalHighFindingsIncluded: severities.criticalCount + severities.highCount,
            vulnerabilityTrend: trend,
            vulnerabilityTrendDelta: (0, report_metrics_1.trendDelta)(trend),
            trendWindowDays: TREND_WINDOW_DAYS,
        };
    }
    async remove(id, userId) {
        const report = await this.prisma.report.findFirst({
            where: { id, assessment: { project: { userId } } },
        });
        if (!report)
            throw new common_1.NotFoundException('Report not found');
        await this.prisma.report.delete({ where: { id } });
        await this.storage.delete(report.filePath);
        return { message: 'Report deleted' };
    }
    async assertAssessmentAccess(assessmentId, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { id: true },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        return assessment;
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = ReportsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        report_generator_service_1.ReportGeneratorService,
        report_storage_service_1.ReportStorageService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map