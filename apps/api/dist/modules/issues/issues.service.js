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
exports.IssuesService = exports.OPEN_ISSUE_STATUSES = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
exports.OPEN_ISSUE_STATUSES = [
    client_1.IssueStatus.OPEN,
    client_1.IssueStatus.ACKNOWLEDGED,
    client_1.IssueStatus.ACCEPTED_RISK,
];
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
let IssuesService = class IssuesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(userId, filters = {}) {
        const page = Math.max(1, filters.page ?? 1);
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
        const where = {
            project: { userId, isActive: true, ...(filters.projectId ? { id: filters.projectId } : {}) },
            ...(filters.status ? { status: this.parseStatus(filters.status) } : {}),
            ...(filters.severity ? { severity: this.parseSeverity(filters.severity) } : {}),
            ...(filters.owaspCategory ? { owaspCategory: filters.owaspCategory } : {}),
            ...(filters.pluginId ? { pluginId: filters.pluginId } : {}),
            ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
            ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
            ...(filters.search
                ? {
                    OR: [
                        { title: { contains: filters.search, mode: 'insensitive' } },
                        { normalizedRoute: { contains: filters.search, mode: 'insensitive' } },
                    ],
                }
                : {}),
        };
        const [total, data] = await Promise.all([
            this.prisma.securityIssue.count({ where }),
            this.prisma.securityIssue.findMany({
                where,
                include: {
                    project: { select: { id: true, name: true } },
                    assignee: { select: { id: true, name: true, email: true } },
                },
                orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        return {
            data,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
        };
    }
    async getGuidance(id, userId) {
        const issue = await this.prisma.securityIssue.findFirst({
            where: { id, project: { userId } },
            select: { id: true },
        });
        if (!issue)
            throw new common_1.NotFoundException('Issue not found');
        const guidance = await this.prisma.issueGuidance.findUnique({
            where: { issueId: id },
        });
        if (!guidance) {
            return {
                status: 'UNAVAILABLE',
                reason: 'No AI guidance has been generated for this issue. It may predate AI analysis, or AI analysis may be disabled.',
                guidance: null,
            };
        }
        return {
            status: guidance.status,
            reason: guidance.status === 'FAILED'
                ? describeGuidanceFailure(guidance.errorCode)
                : null,
            guidance: guidance.payload ?? null,
            metadata: {
                provider: guidance.provider,
                model: guidance.model,
                promptVersion: guidance.promptVersion,
                knowledgeVersion: guidance.knowledgeVersion,
                schemaVersion: guidance.schemaVersion,
                playbookIds: guidance.playbookIds,
                confidence: guidance.confidence,
                generatedAt: guidance.generatedAt,
                tokensInput: guidance.tokensInput,
                tokensOutput: guidance.tokensOutput,
                estimatedCostUsd: guidance.costUsd,
            },
        };
    }
    async findOne(id, userId) {
        const issue = await this.prisma.securityIssue.findFirst({
            where: { id, project: { userId } },
            include: {
                project: { select: { id: true, name: true, baseUrl: true } },
                assignee: { select: { id: true, name: true, email: true } },
                occurrences: {
                    orderBy: { detectedAt: 'desc' },
                    take: 50,
                    include: {
                        assessment: { select: { id: true, createdAt: true, status: true } },
                    },
                },
                statusChanges: {
                    orderBy: { createdAt: 'desc' },
                    include: { actor: { select: { id: true, name: true, email: true } } },
                },
            },
        });
        if (!issue)
            throw new common_1.NotFoundException('Issue not found');
        return issue;
    }
    async updateStatus(id, userId, input) {
        const issue = await this.prisma.securityIssue.findFirst({
            where: { id, project: { userId } },
            select: { id: true, status: true },
        });
        if (!issue)
            throw new common_1.NotFoundException('Issue not found');
        const toStatus = this.parseStatus(input.status);
        const REASON_REQUIRED = [
            client_1.IssueStatus.FALSE_POSITIVE,
            client_1.IssueStatus.ACCEPTED_RISK,
            client_1.IssueStatus.RESOLVED,
        ];
        if (REASON_REQUIRED.includes(toStatus) && !input.reason?.trim()) {
            throw new common_1.BadRequestException(`A reason is required when marking an issue as ${toStatus}.`);
        }
        if (toStatus === issue.status)
            return this.findOne(id, userId);
        const acceptedRiskUntil = input.acceptedRiskUntil ? new Date(input.acceptedRiskUntil) : null;
        if (acceptedRiskUntil && Number.isNaN(acceptedRiskUntil.getTime())) {
            throw new common_1.BadRequestException('acceptedRiskUntil must be a valid date.');
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.securityIssue.update({
                where: { id },
                data: {
                    status: toStatus,
                    resolvedAt: toStatus === client_1.IssueStatus.RESOLVED ? new Date() : null,
                    acceptedRiskUntil: toStatus === client_1.IssueStatus.ACCEPTED_RISK ? acceptedRiskUntil : null,
                    ...(input.reason?.trim() ? { notes: input.reason.trim() } : {}),
                },
            });
            await tx.issueStatusChange.create({
                data: {
                    issueId: id,
                    fromStatus: issue.status,
                    toStatus,
                    actorId: userId,
                    reason: input.reason?.trim() || null,
                    automatic: false,
                    acceptedRiskUntil: toStatus === client_1.IssueStatus.ACCEPTED_RISK ? acceptedRiskUntil : null,
                },
            });
        });
        return this.findOne(id, userId);
    }
    async assign(id, userId, assigneeId) {
        const issue = await this.prisma.securityIssue.findFirst({
            where: { id, project: { userId } },
            select: { id: true },
        });
        if (!issue)
            throw new common_1.NotFoundException('Issue not found');
        if (assigneeId) {
            const assignee = await this.prisma.user.findFirst({
                where: { id: assigneeId, isActive: true },
                select: { id: true },
            });
            if (!assignee) {
                throw new common_1.BadRequestException('Assignee must be an active user.');
            }
        }
        await this.prisma.securityIssue.update({ where: { id }, data: { assigneeId } });
        return this.findOne(id, userId);
    }
    async getStats(userId, projectId) {
        const where = {
            project: { userId, isActive: true, ...(projectId ? { id: projectId } : {}) },
        };
        const [bySeverity, byStatus, byOwasp, total, open] = await Promise.all([
            this.prisma.securityIssue.groupBy({
                by: ['severity'],
                where: { ...where, status: { in: exports.OPEN_ISSUE_STATUSES } },
                _count: { _all: true },
            }),
            this.prisma.securityIssue.groupBy({ by: ['status'], where, _count: { _all: true } }),
            this.prisma.securityIssue.groupBy({
                by: ['owaspCategory'],
                where: { ...where, status: { in: exports.OPEN_ISSUE_STATUSES } },
                _count: { _all: true },
                orderBy: { _count: { owaspCategory: 'desc' } },
                take: 10,
            }),
            this.prisma.securityIssue.count({ where }),
            this.prisma.securityIssue.count({ where: { ...where, status: { in: exports.OPEN_ISSUE_STATUSES } } }),
        ]);
        return { bySeverity, byStatus, byOwasp, total, open };
    }
    async findOccurrencesByAssessment(assessmentId, userId) {
        const assessment = await this.prisma.assessment.findFirst({
            where: { id: assessmentId, project: { userId } },
            select: { id: true },
        });
        if (!assessment)
            throw new common_1.NotFoundException('Scan not found');
        return this.prisma.findingOccurrence.findMany({
            where: { assessmentId },
            orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
            include: {
                issue: {
                    select: { id: true, status: true, firstSeenAt: true, lastSeenAt: true, occurrenceCount: true },
                },
            },
        });
    }
    parseStatus(value) {
        const normalized = value?.trim().toUpperCase();
        if (!normalized || !(normalized in client_1.IssueStatus)) {
            throw new common_1.BadRequestException(`Unknown issue status "${value}". Expected one of: ${Object.keys(client_1.IssueStatus).join(', ')}.`);
        }
        return normalized;
    }
    parseSeverity(value) {
        const normalized = value?.trim().toUpperCase();
        if (!normalized || !(normalized in client_1.Severity)) {
            throw new common_1.BadRequestException(`Unknown severity "${value}". Expected one of: ${Object.keys(client_1.Severity).join(', ')}.`);
        }
        return normalized;
    }
};
exports.IssuesService = IssuesService;
exports.IssuesService = IssuesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], IssuesService);
function describeGuidanceFailure(errorCode) {
    switch (errorCode) {
        case 'PROVIDER_UNAVAILABLE':
            return 'The AI provider rejected the request — it may be rate limited, out of quota, or misconfigured. Scanner evidence is unaffected.';
        case 'NOT_JSON':
        case 'NOT_AN_OBJECT':
        case 'MISSING_REQUIRED_FIELDS':
            return 'The AI provider returned a response that could not be validated. Scanner evidence is unaffected.';
        case 'EMPTY_RESPONSE':
            return 'The AI provider returned an empty response. Scanner evidence is unaffected.';
        default:
            return 'AI guidance could not be generated for this issue. Scanner evidence is unaffected.';
    }
}
//# sourceMappingURL=issues.service.js.map