import { IssueStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
export declare const OPEN_ISSUE_STATUSES: IssueStatus[];
export interface IssueFilters {
    projectId?: string;
    status?: string;
    severity?: string;
    owaspCategory?: string;
    pluginId?: string;
    ruleId?: string;
    assigneeId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}
export interface UpdateIssueStatusInput {
    status: string;
    reason?: string;
    acceptedRiskUntil?: string;
}
export declare class IssuesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(userId: string, filters?: IssueFilters): Promise<{
        data: ({
            project: {
                id: string;
                name: string;
            };
            assignee: {
                id: string;
                name: string;
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            description: string;
            title: string;
            method: string;
            status: import("@prisma/client").$Enums.IssueStatus;
            projectId: string;
            severity: import("@prisma/client").$Enums.Severity;
            pluginId: string;
            ruleId: string;
            fingerprint: string;
            normalizedRoute: string;
            component: string;
            fingerprintVersion: string;
            owaspCategory: string;
            cweId: string | null;
            cvssScore: number | null;
            cvssVector: string | null;
            notes: string | null;
            assigneeId: string | null;
            acceptedRiskUntil: Date | null;
            firstSeenAt: Date;
            lastSeenAt: Date;
            resolvedAt: Date | null;
            reopenedAt: Date | null;
            reopenCount: number;
            occurrenceCount: number;
        })[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    }>;
    getGuidance(id: string, userId: string): Promise<{
        status: string;
        reason: string;
        guidance: any;
        metadata?: undefined;
    } | {
        status: any;
        reason: string;
        guidance: any;
        metadata: {
            provider: any;
            model: any;
            promptVersion: any;
            knowledgeVersion: any;
            schemaVersion: any;
            playbookIds: any;
            confidence: any;
            generatedAt: any;
            tokensInput: any;
            tokensOutput: any;
            estimatedCostUsd: any;
        };
    }>;
    findOne(id: string, userId: string): Promise<{
        project: {
            id: string;
            name: string;
            baseUrl: string;
        };
        occurrences: ({
            assessment: {
                id: string;
                createdAt: Date;
                status: import("@prisma/client").$Enums.AssessmentStatus;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string;
            issueId: string;
            endpointId: string | null;
            occurrenceKey: string;
            methodSnapshot: string;
            pathSnapshot: string;
            operationIdSnapshot: string | null;
            pluginIdSnapshot: string;
            pluginVersionSnapshot: string;
            ruleIdSnapshot: string;
            severitySnapshot: import("@prisma/client").$Enums.Severity;
            cvssSnapshot: number | null;
            owaspSnapshot: string;
            cweSnapshot: string | null;
            titleSnapshot: string;
            descriptionSnapshot: string;
            impactSnapshot: string | null;
            remediationSnapshot: string | null;
            evidence: Prisma.JsonValue | null;
            httpRequest: string | null;
            httpResponse: string | null;
            affectedUrl: string | null;
            location: string;
            validation: import("@prisma/client").$Enums.OccurrenceValidation;
            assessmentConfigHash: string | null;
            specVersionSnapshot: string | null;
            detectedAt: Date;
        })[];
        assignee: {
            id: string;
            name: string;
            email: string;
        };
        statusChanges: ({
            actor: {
                id: string;
                name: string;
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string | null;
            issueId: string;
            acceptedRiskUntil: Date | null;
            fromStatus: import("@prisma/client").$Enums.IssueStatus | null;
            toStatus: import("@prisma/client").$Enums.IssueStatus;
            reason: string | null;
            automatic: boolean;
            actorId: string | null;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string;
        title: string;
        method: string;
        status: import("@prisma/client").$Enums.IssueStatus;
        projectId: string;
        severity: import("@prisma/client").$Enums.Severity;
        pluginId: string;
        ruleId: string;
        fingerprint: string;
        normalizedRoute: string;
        component: string;
        fingerprintVersion: string;
        owaspCategory: string;
        cweId: string | null;
        cvssScore: number | null;
        cvssVector: string | null;
        notes: string | null;
        assigneeId: string | null;
        acceptedRiskUntil: Date | null;
        firstSeenAt: Date;
        lastSeenAt: Date;
        resolvedAt: Date | null;
        reopenedAt: Date | null;
        reopenCount: number;
        occurrenceCount: number;
    }>;
    updateStatus(id: string, userId: string, input: UpdateIssueStatusInput): Promise<{
        project: {
            id: string;
            name: string;
            baseUrl: string;
        };
        occurrences: ({
            assessment: {
                id: string;
                createdAt: Date;
                status: import("@prisma/client").$Enums.AssessmentStatus;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string;
            issueId: string;
            endpointId: string | null;
            occurrenceKey: string;
            methodSnapshot: string;
            pathSnapshot: string;
            operationIdSnapshot: string | null;
            pluginIdSnapshot: string;
            pluginVersionSnapshot: string;
            ruleIdSnapshot: string;
            severitySnapshot: import("@prisma/client").$Enums.Severity;
            cvssSnapshot: number | null;
            owaspSnapshot: string;
            cweSnapshot: string | null;
            titleSnapshot: string;
            descriptionSnapshot: string;
            impactSnapshot: string | null;
            remediationSnapshot: string | null;
            evidence: Prisma.JsonValue | null;
            httpRequest: string | null;
            httpResponse: string | null;
            affectedUrl: string | null;
            location: string;
            validation: import("@prisma/client").$Enums.OccurrenceValidation;
            assessmentConfigHash: string | null;
            specVersionSnapshot: string | null;
            detectedAt: Date;
        })[];
        assignee: {
            id: string;
            name: string;
            email: string;
        };
        statusChanges: ({
            actor: {
                id: string;
                name: string;
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string | null;
            issueId: string;
            acceptedRiskUntil: Date | null;
            fromStatus: import("@prisma/client").$Enums.IssueStatus | null;
            toStatus: import("@prisma/client").$Enums.IssueStatus;
            reason: string | null;
            automatic: boolean;
            actorId: string | null;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string;
        title: string;
        method: string;
        status: import("@prisma/client").$Enums.IssueStatus;
        projectId: string;
        severity: import("@prisma/client").$Enums.Severity;
        pluginId: string;
        ruleId: string;
        fingerprint: string;
        normalizedRoute: string;
        component: string;
        fingerprintVersion: string;
        owaspCategory: string;
        cweId: string | null;
        cvssScore: number | null;
        cvssVector: string | null;
        notes: string | null;
        assigneeId: string | null;
        acceptedRiskUntil: Date | null;
        firstSeenAt: Date;
        lastSeenAt: Date;
        resolvedAt: Date | null;
        reopenedAt: Date | null;
        reopenCount: number;
        occurrenceCount: number;
    }>;
    assign(id: string, userId: string, assigneeId: string | null): Promise<{
        project: {
            id: string;
            name: string;
            baseUrl: string;
        };
        occurrences: ({
            assessment: {
                id: string;
                createdAt: Date;
                status: import("@prisma/client").$Enums.AssessmentStatus;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string;
            issueId: string;
            endpointId: string | null;
            occurrenceKey: string;
            methodSnapshot: string;
            pathSnapshot: string;
            operationIdSnapshot: string | null;
            pluginIdSnapshot: string;
            pluginVersionSnapshot: string;
            ruleIdSnapshot: string;
            severitySnapshot: import("@prisma/client").$Enums.Severity;
            cvssSnapshot: number | null;
            owaspSnapshot: string;
            cweSnapshot: string | null;
            titleSnapshot: string;
            descriptionSnapshot: string;
            impactSnapshot: string | null;
            remediationSnapshot: string | null;
            evidence: Prisma.JsonValue | null;
            httpRequest: string | null;
            httpResponse: string | null;
            affectedUrl: string | null;
            location: string;
            validation: import("@prisma/client").$Enums.OccurrenceValidation;
            assessmentConfigHash: string | null;
            specVersionSnapshot: string | null;
            detectedAt: Date;
        })[];
        assignee: {
            id: string;
            name: string;
            email: string;
        };
        statusChanges: ({
            actor: {
                id: string;
                name: string;
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            assessmentId: string | null;
            issueId: string;
            acceptedRiskUntil: Date | null;
            fromStatus: import("@prisma/client").$Enums.IssueStatus | null;
            toStatus: import("@prisma/client").$Enums.IssueStatus;
            reason: string | null;
            automatic: boolean;
            actorId: string | null;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string;
        title: string;
        method: string;
        status: import("@prisma/client").$Enums.IssueStatus;
        projectId: string;
        severity: import("@prisma/client").$Enums.Severity;
        pluginId: string;
        ruleId: string;
        fingerprint: string;
        normalizedRoute: string;
        component: string;
        fingerprintVersion: string;
        owaspCategory: string;
        cweId: string | null;
        cvssScore: number | null;
        cvssVector: string | null;
        notes: string | null;
        assigneeId: string | null;
        acceptedRiskUntil: Date | null;
        firstSeenAt: Date;
        lastSeenAt: Date;
        resolvedAt: Date | null;
        reopenedAt: Date | null;
        reopenCount: number;
        occurrenceCount: number;
    }>;
    getStats(userId: string, projectId?: string): Promise<{
        bySeverity: (Prisma.PickEnumerable<Prisma.SecurityIssueGroupByOutputType, "severity"[]> & {
            _count: {
                _all: number;
            };
        })[];
        byStatus: (Prisma.PickEnumerable<Prisma.SecurityIssueGroupByOutputType, "status"[]> & {
            _count: {
                _all: number;
            };
        })[];
        byOwasp: (Prisma.PickEnumerable<Prisma.SecurityIssueGroupByOutputType, "owaspCategory"[]> & {
            _count: {
                _all: number;
            };
        })[];
        total: number;
        open: number;
    }>;
    findOccurrencesByAssessment(assessmentId: string, userId: string): Promise<({
        issue: {
            id: string;
            status: import("@prisma/client").$Enums.IssueStatus;
            firstSeenAt: Date;
            lastSeenAt: Date;
            occurrenceCount: number;
        };
    } & {
        id: string;
        createdAt: Date;
        assessmentId: string;
        issueId: string;
        endpointId: string | null;
        occurrenceKey: string;
        methodSnapshot: string;
        pathSnapshot: string;
        operationIdSnapshot: string | null;
        pluginIdSnapshot: string;
        pluginVersionSnapshot: string;
        ruleIdSnapshot: string;
        severitySnapshot: import("@prisma/client").$Enums.Severity;
        cvssSnapshot: number | null;
        owaspSnapshot: string;
        cweSnapshot: string | null;
        titleSnapshot: string;
        descriptionSnapshot: string;
        impactSnapshot: string | null;
        remediationSnapshot: string | null;
        evidence: Prisma.JsonValue | null;
        httpRequest: string | null;
        httpResponse: string | null;
        affectedUrl: string | null;
        location: string;
        validation: import("@prisma/client").$Enums.OccurrenceValidation;
        assessmentConfigHash: string | null;
        specVersionSnapshot: string | null;
        detectedAt: Date;
    })[]>;
    private parseStatus;
    private parseSeverity;
}
