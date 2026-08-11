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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComparisonService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let ComparisonService = class ComparisonService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getComparisonCandidates(assessmentId, userId) {
        const target = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { id: true, projectId: true, createdAt: true },
        });
        if (!target)
            throw new common_1.NotFoundException('Scan not found');
        return this.prisma.assessment.findMany({
            where: {
                projectId: target.projectId,
                id: { not: target.id },
                status: 'COMPLETED',
                summary: { isNot: null },
            },
            orderBy: { createdAt: 'desc' },
            take: 25,
            select: {
                id: true,
                createdAt: true,
                summary: {
                    select: { securityScore: true, scoreStatus: true, scoreVersion: true, coveragePercent: true },
                },
            },
        });
    }
    async compare(assessmentId, userId, baselineId) {
        if (baselineId && baselineId === assessmentId) {
            throw new common_1.BadRequestException('A scan cannot be compared with itself.');
        }
        const current = await this.loadSide(assessmentId, userId);
        const baseline = baselineId
            ? await this.loadSide(baselineId, userId)
            : await this.findPreviousSide(assessmentId, userId);
        if (!baseline) {
            return {
                comparability: 'NOT_COMPARABLE',
                warnings: ['There is no earlier completed scan of this project to compare against.'],
                current: this.publicSide(current),
                baseline: null,
                scoreDelta: null,
                coverageDelta: null,
                changes: { NEW: [], PERSISTING: [], RESOLVED: [], REOPENED: [], NOT_TESTED: [], OUT_OF_SCOPE: [] },
                scopeChanges: null,
            };
        }
        const [a, b] = await Promise.all([
            this.prisma.assessment.findUnique({ where: { id: current.assessmentId }, select: { projectId: true } }),
            this.prisma.assessment.findUnique({ where: { id: baseline.assessmentId }, select: { projectId: true } }),
        ]);
        if (!a || !b || a.projectId !== b.projectId) {
            throw new common_1.BadRequestException('Both scans must belong to the same project.');
        }
        const { comparability, warnings, scopeChanges } = this.assessComparability(baseline, current);
        const changes = await this.classifyChanges(baseline, current);
        const scoreDelta = baseline.securityScore !== null && current.securityScore !== null
            ? current.securityScore - baseline.securityScore
            : null;
        const coverageDelta = baseline.coveragePercent !== null && current.coveragePercent !== null
            ? Math.round((current.coveragePercent - baseline.coveragePercent) * 10) / 10
            : null;
        if (scoreDelta !== null && scoreDelta > 0 && coverageDelta !== null && coverageDelta < 0) {
            warnings.unshift(`The score rose by ${scoreDelta} points while coverage fell by ${Math.abs(coverageDelta)} points. ` +
                `The later scan examined less of the API, so this is not evidence that risk decreased.`);
        }
        return {
            comparability,
            warnings,
            current: this.publicSide(current),
            baseline: this.publicSide(baseline),
            scoreDelta,
            coverageDelta,
            changes,
            scopeChanges,
        };
    }
    async loadSide(assessmentId, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { id: true, createdAt: true, status: true, summary: true },
        });
        if (!assessment)
            throw new common_1.NotFoundException(`Scan ${assessmentId} not found`);
        return this.toSide(assessment);
    }
    async findPreviousSide(assessmentId, userId) {
        const target = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { projectId: true, createdAt: true },
        });
        if (!target)
            throw new common_1.NotFoundException('Scan not found');
        const previous = await this.prisma.assessment.findFirst({
            where: {
                projectId: target.projectId,
                createdAt: { lt: target.createdAt },
                status: 'COMPLETED',
                summary: { isNot: null },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, createdAt: true, status: true, summary: true },
        });
        return previous ? this.toSide(previous) : null;
    }
    toSide(assessment) {
        const summary = assessment.summary;
        const plan = (summary?.pluginResults ?? {});
        const executed = plan.executed ?? [];
        const failed = plan.failed ?? [];
        return {
            assessmentId: assessment.id,
            createdAt: assessment.createdAt,
            status: assessment.status,
            securityScore: summary?.securityScore ?? null,
            scoreStatus: summary?.scoreStatus ?? 'UNAVAILABLE',
            scoreVersion: summary?.scoreVersion ?? null,
            coveragePercent: summary?.coveragePercent ?? null,
            plannedChecks: summary?.plannedChecks ?? 0,
            successfulChecks: summary?.successfulChecks ?? 0,
            failedChecks: summary?.failedChecks ?? 0,
            skippedChecks: summary?.skippedChecks ?? 0,
            successfulPlugins: executed.filter((id) => !failed.includes(id)),
            failedPlugins: failed,
            scopePlugins: executed,
        };
    }
    publicSide(side) {
        return {
            assessmentId: side.assessmentId,
            createdAt: side.createdAt,
            securityScore: side.securityScore,
            scoreStatus: side.scoreStatus,
            scoreVersion: side.scoreVersion,
            coveragePercent: side.coveragePercent,
            plannedChecks: side.plannedChecks,
            successfulChecks: side.successfulChecks,
            failedChecks: side.failedChecks,
            skippedChecks: side.skippedChecks,
        };
    }
    assessComparability(baseline, current) {
        const warnings = [];
        const baselineScope = new Set(baseline.scopePlugins);
        const currentScope = new Set(current.scopePlugins);
        const shared = [...baselineScope].filter((id) => currentScope.has(id));
        const added = [...currentScope].filter((id) => !baselineScope.has(id));
        const removed = [...baselineScope].filter((id) => !currentScope.has(id));
        const scopeChanges = {
            sharedChecks: shared.sort(),
            addedChecks: added.sort(),
            removedChecks: removed.sort(),
        };
        if (baseline.securityScore === null || current.securityScore === null) {
            warnings.push('At least one of the scans has no computable score, so the two cannot be compared numerically.');
            return { comparability: 'NOT_COMPARABLE', warnings, scopeChanges };
        }
        if (baseline.scoreVersion !== current.scoreVersion) {
            warnings.push(`The scans were scored with different algorithm versions ` +
                `(${baseline.scoreVersion ?? 'unknown'} vs ${current.scoreVersion ?? 'unknown'}), ` +
                `so their scores are not the same quantity and cannot be compared directly.`);
            return { comparability: 'NOT_COMPARABLE', warnings, scopeChanges };
        }
        if (shared.length === 0) {
            warnings.push('The two scans have no checks in common, so there is nothing to compare.');
            return { comparability: 'NOT_COMPARABLE', warnings, scopeChanges };
        }
        let comparability = 'COMPARABLE';
        if (added.length > 0 || removed.length > 0) {
            warnings.push(`Scope changed: ${baseline.scopePlugins.length} check(s) in the baseline, ` +
                `${current.scopePlugins.length} in the current scan. ` +
                `Results outside the ${shared.length} shared check(s) are marked as not tested.`);
            comparability = 'PARTIALLY_COMPARABLE';
        }
        if (baseline.failedChecks > 0 || current.failedChecks > 0) {
            warnings.push(`Execution failures occurred (${baseline.failedChecks} in the baseline, ${current.failedChecks} in the current scan), so part of the comparison is unreliable.`);
            comparability = 'PARTIALLY_COMPARABLE';
        }
        if (baseline.scoreStatus !== 'FINAL' || current.scoreStatus !== 'FINAL') {
            warnings.push(`At least one score is provisional (baseline: ${baseline.scoreStatus}, current: ${current.scoreStatus}).`);
            comparability = 'PARTIALLY_COMPARABLE';
        }
        return { comparability, warnings, scopeChanges };
    }
    async classifyChanges(baseline, current) {
        const [baselineOccurrences, currentOccurrences] = await Promise.all([
            this.loadOccurrenceIdentities(baseline.assessmentId),
            this.loadOccurrenceIdentities(current.assessmentId),
        ]);
        const currentByFingerprint = new Map(currentOccurrences.map((o) => [o.fingerprint, o]));
        const baselineByFingerprint = new Map(baselineOccurrences.map((o) => [o.fingerprint, o]));
        const currentSuccessful = new Set(current.successfulPlugins);
        const currentScope = new Set(current.scopePlugins);
        const changes = {
            NEW: [],
            PERSISTING: [],
            RESOLVED: [],
            REOPENED: [],
            NOT_TESTED: [],
            OUT_OF_SCOPE: [],
        };
        for (const occurrence of currentOccurrences) {
            const previously = baselineByFingerprint.get(occurrence.fingerprint);
            const entry = {
                fingerprint: occurrence.fingerprint,
                issueId: occurrence.issueId,
                title: occurrence.title,
                severity: occurrence.severity,
                pluginId: occurrence.pluginId,
                ruleId: occurrence.ruleId,
                route: `${occurrence.method} ${occurrence.route}`,
                ...(previously && previously.severity !== occurrence.severity
                    ? { severityChangedFrom: previously.severity }
                    : {}),
            };
            if (!previously) {
                (occurrence.reopenCount > 0 ? changes.REOPENED : changes.NEW).push(entry);
            }
            else {
                changes.PERSISTING.push(entry);
            }
        }
        for (const occurrence of baselineOccurrences) {
            if (currentByFingerprint.has(occurrence.fingerprint))
                continue;
            const entry = {
                fingerprint: occurrence.fingerprint,
                issueId: occurrence.issueId,
                title: occurrence.title,
                severity: occurrence.severity,
                pluginId: occurrence.pluginId,
                ruleId: occurrence.ruleId,
                route: `${occurrence.method} ${occurrence.route}`,
            };
            if (!currentScope.has(occurrence.pluginId)) {
                changes.OUT_OF_SCOPE.push(entry);
            }
            else if (!currentSuccessful.has(occurrence.pluginId)) {
                changes.NOT_TESTED.push(entry);
            }
            else {
                changes.RESOLVED.push(entry);
            }
        }
        return changes;
    }
    async loadOccurrenceIdentities(assessmentId) {
        const occurrences = await this.prisma.findingOccurrence.findMany({
            where: { assessmentId },
            select: {
                issueId: true,
                titleSnapshot: true,
                severitySnapshot: true,
                pluginIdSnapshot: true,
                ruleIdSnapshot: true,
                methodSnapshot: true,
                pathSnapshot: true,
                issue: { select: { fingerprint: true, reopenCount: true } },
            },
        });
        return occurrences.map((o) => ({
            issueId: o.issueId,
            fingerprint: o.issue.fingerprint,
            title: o.titleSnapshot,
            severity: o.severitySnapshot,
            pluginId: o.pluginIdSnapshot,
            ruleId: o.ruleIdSnapshot,
            method: o.methodSnapshot,
            route: o.pathSnapshot,
            reopenCount: o.issue.reopenCount,
        }));
    }
};
exports.ComparisonService = ComparisonService;
exports.ComparisonService = ComparisonService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ComparisonService);
//# sourceMappingURL=comparison.service.js.map