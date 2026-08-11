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
var ScannerProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
const scanner_service_1 = require("./scanner.service");
const url_resolver_util_1 = require("../../common/utils/url-resolver.util");
const crypto_1 = require("crypto");
const crypto_service_1 = require("../../common/crypto/crypto.service");
const auth_config_crypto_1 = require("../../common/crypto/auth-config.crypto");
const issue_lifecycle_service_1 = require("../issues/issue-lifecycle.service");
const scoring_service_1 = require("../scoring/scoring.service");
const plugin_registry_service_1 = require("../plugins/plugin-registry.service");
const reports_service_1 = require("../reports/reports.service");
const issue_guidance_service_1 = require("../ai/guidance/issue-guidance.service");
const assessment_finding_counts_1 = require("../assessments/assessment-finding-counts");
let ScannerProcessor = ScannerProcessor_1 = class ScannerProcessor extends bullmq_1.WorkerHost {
    constructor(prisma, scannerService, eventEmitter, pluginRegistry, reportsService, crypto, issueLifecycle, scoring, issueGuidance) {
        super();
        this.prisma = prisma;
        this.scannerService = scannerService;
        this.eventEmitter = eventEmitter;
        this.pluginRegistry = pluginRegistry;
        this.reportsService = reportsService;
        this.crypto = crypto;
        this.issueLifecycle = issueLifecycle;
        this.scoring = scoring;
        this.issueGuidance = issueGuidance;
        this.logger = new common_1.Logger(ScannerProcessor_1.name);
    }
    hashConfig(config) {
        if (!config)
            return undefined;
        const relevant = {
            executionMode: config.executionMode,
            resolvedPlugins: [...(config.resolvedPlugins ?? [])].sort(),
            maxRequestsPerEndpoint: config.maxRequestsPerEndpoint,
            requestDelayMs: config.requestDelayMs,
            timeoutMs: config.timeoutMs,
            enableAiAnalysis: config.enableAiAnalysis,
        };
        return (0, crypto_1.createHash)('sha256').update(JSON.stringify(relevant), 'utf8').digest('hex');
    }
    async process(job) {
        const { assessmentId, projectId, specId, userId } = job.data;
        const startTime = Date.now();
        this.logger.log(`Starting assessment ${assessmentId} (user: ${userId ?? 'anonymous'})`);
        try {
            await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: { status: 'RUNNING', startedAt: new Date(), progress: 0 },
            });
            this.emit(assessmentId, {
                step: 'Initializing', stepIndex: 0, totalSteps: 12,
                progress: 2, message: 'Initializing assessment engine...', findingsCount: 0,
            });
            const [spec, project] = await Promise.all([
                this.prisma.apiSpec.findUnique({
                    where: { id: specId },
                    include: { authConfig: true, endpoints: true },
                }),
                this.prisma.project.findUnique({ where: { id: projectId } }),
            ]);
            if (!spec)
                throw new Error('API specification not found');
            if (!project)
                throw new Error('Project not found');
            const assessmentConfig = await this.prisma.assessmentConfig.findUnique({
                where: { assessmentId },
            });
            let resolvedPluginIds = assessmentConfig?.resolvedPlugins ?? [];
            if (!resolvedPluginIds.length && assessmentConfig?.executionMode === 'profile' && assessmentConfig.scanProfileId) {
                const legacyProfile = await this.prisma.scanProfile.findUnique({ where: { id: assessmentConfig.scanProfileId } });
                resolvedPluginIds = legacyProfile?.enabledPlugins ?? [];
            }
            else if (!resolvedPluginIds.length && assessmentConfig?.executionMode === 'manual') {
                resolvedPluginIds = assessmentConfig.manualPlugins ?? [];
            }
            else if (!resolvedPluginIds.length && (!assessmentConfig?.executionMode || assessmentConfig.executionMode === 'all')) {
                resolvedPluginIds = userId
                    ? (await this.pluginRegistry.getEnabledForUser(userId)).map((plugin) => plugin.manifest.id)
                    : (await this.pluginRegistry.getEnabledGlobally()).map((plugin) => plugin.manifest.id);
            }
            if (!resolvedPluginIds.length)
                throw new Error('Assessment has no resolved plugins');
            const pluginOverride = this.pluginRegistry.getByIds(resolvedPluginIds);
            if (pluginOverride.length !== resolvedPluginIds.length) {
                throw new Error('One or more assessment plugins are no longer available');
            }
            this.emit(assessmentId, {
                step: 'Parsing', stepIndex: 1, totalSteps: 12,
                progress: 8, message: `Discovered ${spec.endpoints.length} endpoints`, findingsCount: 0,
            });
            await this.addLog(assessmentId, 'info', 'core', `Found ${spec.endpoints.length} endpoints to test`);
            const authConfig = (0, auth_config_crypto_1.decryptAuthFields)(this.crypto, spec.authConfig);
            const context = {
                assessmentId,
                projectId,
                baseUrl: (0, url_resolver_util_1.resolveTargetUrl)(project.baseUrl ?? ''),
                auth: {
                    type: authConfig?.type || 'NONE',
                    token: authConfig?.token ?? undefined,
                    username: authConfig?.username ?? undefined,
                    password: authConfig?.password ?? undefined,
                    apiKey: authConfig?.apiKey ?? undefined,
                    apiKeyHeader: authConfig?.apiKeyHeader ?? undefined,
                    apiKeyLocation: authConfig?.apiKeyLocation ?? 'header',
                    customHeaders: authConfig?.customHeaders ?? undefined,
                },
                endpoints: spec.endpoints.map((e) => ({
                    id: e.id,
                    path: e.path,
                    method: e.method,
                    summary: e.summary ?? undefined,
                    tags: e.tags,
                    parameters: e.parameters ?? [],
                    requestBody: e.requestBody ?? undefined,
                    responses: e.responses ?? undefined,
                    security: e.security ?? [],
                    deprecated: e.deprecated,
                })),
                config: {
                    executionMode: assessmentConfig?.executionMode ?? 'all',
                    enableAiAnalysis: assessmentConfig?.enableAiAnalysis ?? true,
                    maxRequestsPerEndpoint: assessmentConfig?.maxRequestsPerEndpoint ?? 10,
                    requestDelayMs: assessmentConfig?.requestDelayMs ?? 200,
                    timeoutMs: assessmentConfig?.timeoutMs ?? 10000,
                },
            };
            await this.prisma.assessmentSummary.upsert({
                where: { assessmentId },
                update: { totalEndpoints: spec.endpoints.length },
                create: { assessmentId, totalEndpoints: spec.endpoints.length, testedEndpoints: 0 },
            });
            const { findings, pluginPlan, aiMeta } = await this.scannerService.runAllPlugins(context, (progress) => {
                this.emit(assessmentId, progress);
                this.updateProgress(assessmentId, progress.progress);
            }, (logEntry) => {
                this.addLog(assessmentId, logEntry.level, logEntry.plugin, logEntry.message);
            }, userId, pluginOverride);
            this.emit(assessmentId, {
                step: 'Saving Results', stepIndex: 11, totalSteps: 12,
                progress: 92, message: `Saving ${findings.length} findings...`, findingsCount: findings.length,
            });
            const detectedAt = new Date();
            const lifecycle = await this.issueLifecycle.persistScanResults({
                projectId,
                assessmentId,
                findings,
                detectedAt,
                assessmentConfigHash: this.hashConfig(assessmentConfig),
                specVersion: spec.version ?? undefined,
                scope: {
                    successfulPlugins: pluginPlan.executed.filter((id) => !pluginPlan.failed.includes(id)),
                    failedPlugins: pluginPlan.failed,
                    skippedPlugins: pluginPlan.skipped,
                    pluginVersions: pluginPlan.versions,
                },
            });
            await this.addLog(assessmentId, 'info', 'core', `Persisted ${lifecycle.occurrencesCreated} detections — ` +
                `${lifecycle.issuesCreated} new, ${lifecycle.issuesRecurring} recurring, ` +
                `${lifecycle.issuesReopened} reopened, ${lifecycle.issuesResolved} resolved, ` +
                `${lifecycle.issuesNotTested} not tested` +
                (lifecycle.occurrencesSkipped > 0
                    ? ` (${lifecycle.occurrencesSkipped} already recorded by a previous attempt)`
                    : ''));
            let guidanceMeta = null;
            if (assessmentConfig?.enableAiAnalysis !== false) {
                try {
                    const scannedIssues = await this.prisma.securityIssue.findMany({
                        where: { projectId, occurrences: { some: { assessmentId } } },
                        select: { id: true },
                    });
                    guidanceMeta = await this.issueGuidance.enrichIssues({
                        issueIds: scannedIssues.map((issue) => issue.id),
                        projectId,
                        authType: authConfig?.type ?? null,
                    });
                    await this.addLog(assessmentId, guidanceMeta.failed > 0 ? 'warn' : 'info', 'ai', `AI guidance: ${guidanceMeta.succeeded} generated, ${guidanceMeta.failed} failed, ` +
                        `${guidanceMeta.skipped} skipped (${guidanceMeta.provider}/${guidanceMeta.model}, ` +
                        `~$${guidanceMeta.estimatedCostUsd.toFixed(4)} estimated)`);
                }
                catch (error) {
                    this.logger.warn(`AI guidance step failed entirely: ${error?.message}`);
                    await this.addLog(assessmentId, 'warn', 'ai', `AI guidance unavailable: ${error?.message}. Scanner evidence is unaffected.`);
                }
            }
            const summary = await this.summariseDetections(assessmentId);
            const plannedChecks = pluginPlan.executed.length;
            const failedChecks = pluginPlan.failed.length;
            const successfulChecks = plannedChecks - failedChecks;
            const skippedChecks = pluginPlan.skipped.length;
            await this.prisma.assessmentSummary.update({
                where: { assessmentId },
                data: {
                    testedEndpoints: spec.endpoints.length,
                    totalFindings: summary.total,
                    criticalCount: summary.critical,
                    highCount: summary.high,
                    mediumCount: summary.medium,
                    lowCount: summary.low,
                    infoCount: summary.info,
                    plannedChecks,
                    successfulChecks,
                    failedChecks,
                    skippedChecks,
                    executionErrors: failedChecks,
                    riskLevel: summary.riskLevel,
                    owaspCoverage: summary.owaspCoverage,
                    pluginResults: pluginPlan,
                    aiStatus: aiMeta,
                },
            });
            const duration = Math.round((Date.now() - startTime) / 1000);
            await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    progress: 100,
                    duration,
                    currentStep: 'Completed',
                },
            });
            const score = await this.scoring.scoreAssessment(assessmentId);
            await this.addLog(assessmentId, 'info', 'core', score.securityScore === null
                ? `Score unavailable: ${score.reasons.join(' ')}`
                : `Score ${score.securityScore}/100 (${score.scoreStatus}, ${score.scoreVersion}) — ` +
                    `coverage ${score.coveragePercent ?? 'unknown'}%`);
            this.autoGenerateReport(assessmentId, userId).catch((err) => this.logger.warn(`Auto-report generation failed for ${assessmentId}: ${err.message}`));
            this.emit(assessmentId, {
                step: 'Completed',
                stepIndex: 12,
                totalSteps: 12,
                progress: 100,
                message: `Assessment completed — ${summary.total} issue${summary.total === 1 ? '' : 's'} found in ${duration}s`,
                findingsCount: summary.total,
                completed: true,
                pluginPlan,
                aiMeta,
            });
            this.logger.log(`Assessment ${assessmentId} completed in ${duration}s — ` +
                `${summary.total} findings recorded from ${findings.length} raw detections, ` +
                `${pluginPlan.executed.length} plugins ran, ` +
                `${pluginPlan.skipped.length} skipped, AI: ${aiMeta.available ? aiMeta.provider : 'off'}`);
            return { assessmentId, findingsCount: summary.total, duration, pluginPlan, aiMeta };
        }
        catch (error) {
            this.logger.error(`Assessment ${assessmentId} failed: ${error.message}`, error.stack);
            await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: { status: 'FAILED', completedAt: new Date(), currentStep: `Failed: ${error.message}` },
            });
            await this.prisma.assessmentSummary
                .update({
                where: { assessmentId },
                data: {
                    securityScore: null,
                    scoreStatus: 'UNAVAILABLE',
                    scoreVersion: null,
                    scoreComputedAt: null,
                },
            })
                .catch(() => {
            });
            await this.addLog(assessmentId, 'error', 'core', error.message);
            this.emit(assessmentId, {
                step: 'Failed',
                progress: 0,
                message: `Assessment failed: ${error.message}`,
                findingsCount: 0,
                error: error.message,
            });
            throw error;
        }
    }
    emit(assessmentId, data) {
        this.eventEmitter.emit('scanner.progress', { assessmentId, ...data });
    }
    async updateProgress(assessmentId, progress) {
        await this.prisma.assessment.update({
            where: { id: assessmentId },
            data: { progress },
        });
    }
    async addLog(assessmentId, level, plugin, message) {
        await this.prisma.assessmentLog.create({
            data: { assessmentId, level, plugin, message },
        });
    }
    async autoGenerateReport(assessmentId, userId) {
        const owner = userId ??
            (await this.prisma.assessment.findUnique({
                where: { id: assessmentId },
                select: { project: { select: { userId: true } } },
            }))?.project?.userId;
        if (!owner) {
            this.logger.warn(`Skipping auto-report for ${assessmentId}: no owning user could be resolved.`);
            return;
        }
        await this.reportsService.generate(assessmentId, owner, {
            type: 'TECHNICAL',
            format: 'PDF',
        });
    }
    async summariseDetections(assessmentId) {
        const [bySeverity, byCategory] = await Promise.all([
            this.prisma.findingOccurrence.groupBy({
                by: ['assessmentId', 'severitySnapshot'],
                where: { assessmentId },
                _count: { _all: true },
            }),
            this.prisma.findingOccurrence.groupBy({
                by: ['owaspSnapshot'],
                where: { assessmentId },
                _count: { _all: true },
            }),
        ]);
        const counts = (0, assessment_finding_counts_1.foldOccurrenceCounts)(bySeverity).get(assessmentId) ??
            (0, assessment_finding_counts_1.emptyFindingCounts)();
        const owaspCoverage = {};
        for (const row of byCategory) {
            if (row.owaspSnapshot)
                owaspCoverage[row.owaspSnapshot] = row._count._all;
        }
        return { ...counts, riskLevel: (0, assessment_finding_counts_1.riskLevelFor)(counts), owaspCoverage };
    }
};
exports.ScannerProcessor = ScannerProcessor;
exports.ScannerProcessor = ScannerProcessor = ScannerProcessor_1 = __decorate([
    (0, bullmq_1.Processor)('scanner', { concurrency: 3 }),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        scanner_service_1.ScannerService,
        event_emitter_1.EventEmitter2,
        plugin_registry_service_1.PluginRegistryService,
        reports_service_1.ReportsService,
        crypto_service_1.CryptoService,
        issue_lifecycle_service_1.IssueLifecycleService,
        scoring_service_1.ScoringService,
        issue_guidance_service_1.IssueGuidanceService])
], ScannerProcessor);
//# sourceMappingURL=scanner.processor.js.map