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
var IssueLifecycleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueLifecycleService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const fingerprint_util_1 = require("../../common/identity/fingerprint.util");
const redact_util_1 = require("../../common/utils/redact.util");
const UNIQUE_VIOLATION = 'P2002';
let IssueLifecycleService = IssueLifecycleService_1 = class IssueLifecycleService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(IssueLifecycleService_1.name);
    }
    async persistScanResults(input) {
        const output = {
            issuesCreated: 0,
            issuesReopened: 0,
            issuesRecurring: 0,
            occurrencesCreated: 0,
            occurrencesSkipped: 0,
            issuesResolved: 0,
            issuesNotTested: 0,
        };
        const detections = this.resolveIdentities(input);
        for (const detection of detections) {
            const result = await this.persistDetection(detection, input);
            output.issuesCreated += result.issueCreated ? 1 : 0;
            output.issuesReopened += result.reopened ? 1 : 0;
            output.issuesRecurring += result.recurring ? 1 : 0;
            output.occurrencesCreated += result.occurrenceCreated ? 1 : 0;
            output.occurrencesSkipped += result.occurrenceCreated ? 0 : 1;
        }
        const reconciliation = await this.reconcile(input, detections);
        output.issuesResolved = reconciliation.resolved;
        output.issuesNotTested = reconciliation.notTested;
        return output;
    }
    resolveIdentities(input) {
        const detections = new Map();
        for (const finding of input.findings) {
            if (!finding.pluginId || !finding.ruleId) {
                this.logger.error(`Discarding a finding from "${finding.pluginId || 'unknown plugin'}": ` +
                    `it has no ruleId, so it has no stable identity.`);
                continue;
            }
            const identity = (0, fingerprint_util_1.computeFingerprint)({
                projectId: input.projectId,
                pluginId: finding.pluginId,
                ruleId: finding.ruleId,
                method: finding.method,
                route: finding.route,
                component: finding.component,
            });
            const detection = {
                finding,
                identity,
                occurrenceKey: (0, fingerprint_util_1.computeOccurrenceKey)(identity.fingerprintVersion, identity.fingerprint),
            };
            if (!detections.has(detection.occurrenceKey)) {
                detections.set(detection.occurrenceKey, detection);
            }
        }
        return [...detections.values()];
    }
    async persistDetection(detection, input) {
        const { finding, identity } = detection;
        const severity = finding.severity;
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.securityIssue.findUnique({
                where: {
                    projectId_fingerprintVersion_fingerprint: {
                        projectId: identity.projectId,
                        fingerprintVersion: identity.fingerprintVersion,
                        fingerprint: identity.fingerprint,
                    },
                },
                select: { id: true, status: true, acceptedRiskUntil: true, occurrenceCount: true },
            });
            const issue = existing
                ? { id: existing.id, created: false }
                : {
                    id: (await tx.securityIssue.create({
                        data: {
                            projectId: identity.projectId,
                            fingerprint: identity.fingerprint,
                            fingerprintVersion: identity.fingerprintVersion,
                            pluginId: identity.pluginId,
                            ruleId: identity.ruleId,
                            method: identity.method,
                            normalizedRoute: identity.normalizedRoute,
                            component: identity.component,
                            title: finding.title,
                            description: finding.description,
                            severity,
                            owaspCategory: finding.owaspCategory,
                            cweId: finding.cweId,
                            cvssScore: finding.cvssScore,
                            cvssVector: finding.cvssVector,
                            status: client_1.IssueStatus.OPEN,
                            firstSeenAt: input.detectedAt,
                            lastSeenAt: input.detectedAt,
                            occurrenceCount: 0,
                        },
                        select: { id: true },
                    })).id,
                    created: true,
                };
            const occurrenceCreated = await this.tryCreateOccurrence(tx, issue.id, detection, input, severity);
            if (!occurrenceCreated) {
                return { issueCreated: issue.created, occurrenceCreated: false, reopened: false, recurring: false };
            }
            const transition = this.decideTransition(existing?.status ?? client_1.IssueStatus.OPEN, existing?.acceptedRiskUntil ?? null, input.detectedAt);
            await tx.securityIssue.update({
                where: { id: issue.id },
                data: {
                    lastSeenAt: input.detectedAt,
                    occurrenceCount: { increment: 1 },
                    title: finding.title,
                    description: finding.description,
                    severity,
                    cvssScore: finding.cvssScore,
                    cvssVector: finding.cvssVector,
                    cweId: finding.cweId,
                    ...(transition
                        ? {
                            status: transition.to,
                            reopenedAt: input.detectedAt,
                            resolvedAt: null,
                            reopenCount: { increment: 1 },
                        }
                        : {}),
                },
            });
            if (transition) {
                await tx.issueStatusChange.create({
                    data: {
                        issueId: issue.id,
                        fromStatus: transition.from,
                        toStatus: transition.to,
                        assessmentId: input.assessmentId,
                        automatic: true,
                        reason: transition.reason,
                    },
                });
            }
            return {
                issueCreated: issue.created,
                occurrenceCreated: true,
                reopened: Boolean(transition),
                recurring: !issue.created && !transition,
            };
        });
    }
    async tryCreateOccurrence(tx, issueId, detection, input, severity) {
        const { finding, identity, occurrenceKey } = detection;
        try {
            await tx.findingOccurrence.create({
                data: {
                    issueId,
                    assessmentId: input.assessmentId,
                    endpointId: finding.endpointId ?? null,
                    occurrenceKey,
                    methodSnapshot: identity.method,
                    pathSnapshot: identity.normalizedRoute,
                    pluginIdSnapshot: identity.pluginId,
                    pluginVersionSnapshot: input.scope.pluginVersions[identity.pluginId] ?? 'unknown',
                    ruleIdSnapshot: identity.ruleId,
                    severitySnapshot: severity,
                    cvssSnapshot: finding.cvssScore,
                    owaspSnapshot: finding.owaspCategory,
                    cweSnapshot: finding.cweId,
                    titleSnapshot: finding.title,
                    descriptionSnapshot: finding.description,
                    impactSnapshot: finding.impact,
                    remediationSnapshot: finding.remediation,
                    evidence: (0, redact_util_1.redactObject)(finding.evidence) ?? undefined,
                    httpRequest: (0, redact_util_1.redactHttpMessage)(finding.httpRequest),
                    httpResponse: (0, redact_util_1.redactHttpMessage)(finding.httpResponse),
                    affectedUrl: finding.affectedUrl,
                    location: identity.component,
                    assessmentConfigHash: input.assessmentConfigHash,
                    specVersionSnapshot: input.specVersion,
                    detectedAt: input.detectedAt,
                },
            });
            return true;
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
                return false;
            }
            throw error;
        }
    }
    decideTransition(current, acceptedRiskUntil, now) {
        switch (current) {
            case client_1.IssueStatus.RESOLVED:
                return {
                    from: client_1.IssueStatus.RESOLVED,
                    to: client_1.IssueStatus.OPEN,
                    reason: 'Reopened automatically: the issue was detected again after being resolved.',
                };
            case client_1.IssueStatus.ACCEPTED_RISK:
                if (acceptedRiskUntil && acceptedRiskUntil.getTime() <= now.getTime()) {
                    return {
                        from: client_1.IssueStatus.ACCEPTED_RISK,
                        to: client_1.IssueStatus.OPEN,
                        reason: 'Reopened automatically: the risk acceptance expired and the issue is still present.',
                    };
                }
                return null;
            case client_1.IssueStatus.FALSE_POSITIVE:
                return null;
            case client_1.IssueStatus.OPEN:
            case client_1.IssueStatus.ACKNOWLEDGED:
                return null;
            default:
                return null;
        }
    }
    async reconcile(input, detections) {
        const successful = new Set(input.scope.successfulPlugins);
        const detectedFingerprints = new Set(detections.map((d) => d.identity.fingerprint));
        const notTested = await this.prisma.securityIssue.count({
            where: {
                projectId: input.projectId,
                pluginId: { in: [...input.scope.failedPlugins, ...input.scope.skippedPlugins] },
                status: { in: [client_1.IssueStatus.OPEN, client_1.IssueStatus.ACKNOWLEDGED] },
            },
        });
        if (successful.size === 0)
            return { resolved: 0, notTested };
        const candidates = await this.prisma.securityIssue.findMany({
            where: {
                projectId: input.projectId,
                pluginId: { in: [...successful] },
                status: { in: [client_1.IssueStatus.OPEN, client_1.IssueStatus.ACKNOWLEDGED] },
            },
            select: { id: true, status: true, fingerprint: true },
        });
        const stale = candidates.filter((issue) => !detectedFingerprints.has(issue.fingerprint));
        if (stale.length === 0)
            return { resolved: 0, notTested };
        await this.prisma.$transaction(async (tx) => {
            await tx.securityIssue.updateMany({
                where: { id: { in: stale.map((issue) => issue.id) } },
                data: { status: client_1.IssueStatus.RESOLVED, resolvedAt: input.detectedAt },
            });
            await tx.issueStatusChange.createMany({
                data: stale.map((issue) => ({
                    issueId: issue.id,
                    fromStatus: issue.status,
                    toStatus: client_1.IssueStatus.RESOLVED,
                    assessmentId: input.assessmentId,
                    automatic: true,
                    reason: 'Resolved automatically: the check that detects this issue ran successfully in this scan and no longer reported it.',
                })),
            });
        });
        return { resolved: stale.length, notTested };
    }
};
exports.IssueLifecycleService = IssueLifecycleService;
exports.IssueLifecycleService = IssueLifecycleService = IssueLifecycleService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], IssueLifecycleService);
//# sourceMappingURL=issue-lifecycle.service.js.map