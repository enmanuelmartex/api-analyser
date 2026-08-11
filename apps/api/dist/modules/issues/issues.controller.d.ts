import { IssuesService } from './issues.service';
import { AssignIssueDto, IssueQueryDto, UpdateIssueStatusDto } from './dto/issue.dto';
import { AuditService } from '../audit/audit.service';
export declare class IssuesController {
    private readonly issues;
    private readonly audit;
    constructor(issues: IssuesService, audit: AuditService);
    findAll(user: any, query: IssueQueryDto): Promise<{
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
    getStats(user: any, projectId?: string): Promise<{
        bySeverity: (import("@prisma/client").Prisma.PickEnumerable<import("@prisma/client").Prisma.SecurityIssueGroupByOutputType, "severity"[]> & {
            _count: {
                _all: number;
            };
        })[];
        byStatus: (import("@prisma/client").Prisma.PickEnumerable<import("@prisma/client").Prisma.SecurityIssueGroupByOutputType, "status"[]> & {
            _count: {
                _all: number;
            };
        })[];
        byOwasp: (import("@prisma/client").Prisma.PickEnumerable<import("@prisma/client").Prisma.SecurityIssueGroupByOutputType, "owaspCategory"[]> & {
            _count: {
                _all: number;
            };
        })[];
        total: number;
        open: number;
    }>;
    findOccurrences(assessmentId: string, user: any): Promise<({
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
        evidence: import("@prisma/client/runtime/library").JsonValue | null;
        httpRequest: string | null;
        httpResponse: string | null;
        affectedUrl: string | null;
        location: string;
        validation: import("@prisma/client").$Enums.OccurrenceValidation;
        assessmentConfigHash: string | null;
        specVersionSnapshot: string | null;
        detectedAt: Date;
    })[]>;
    getGuidance(id: string, user: any): Promise<{
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
    findOne(id: string, user: any): Promise<{
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
            evidence: import("@prisma/client/runtime/library").JsonValue | null;
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
    updateStatus(id: string, user: any, dto: UpdateIssueStatusDto): Promise<{
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
            evidence: import("@prisma/client/runtime/library").JsonValue | null;
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
    assign(id: string, user: any, dto: AssignIssueDto): Promise<{
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
            evidence: import("@prisma/client/runtime/library").JsonValue | null;
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
}
