import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AssessmentsService } from './assessments.service';
import { RunAssessmentDto } from './dto/run-assessment.dto';
import { AuditService } from '../audit/audit.service';
export declare class AssessmentsController {
    private assessmentsService;
    private audit;
    constructor(assessmentsService: AssessmentsService, audit: AuditService);
    findAll(user: any, projectId?: string): Promise<({
        project: {
            id: string;
            name: string;
            baseUrl: string;
        };
        _count: {
            occurrences: number;
        };
        summary: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            assessmentId: string;
            totalEndpoints: number;
            testedEndpoints: number;
            totalFindings: number;
            criticalCount: number;
            highCount: number;
            mediumCount: number;
            lowCount: number;
            infoCount: number;
            securityScore: number | null;
            scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
            scoreVersion: string | null;
            scoreComputedAt: Date | null;
            scoreExplanation: import("@prisma/client/runtime/library").JsonValue | null;
            riskLevel: string;
            plannedChecks: number;
            successfulChecks: number;
            failedChecks: number;
            skippedChecks: number;
            executionErrors: number;
            coveragePercent: number | null;
            owaspCoverage: import("@prisma/client/runtime/library").JsonValue | null;
            pluginResults: import("@prisma/client/runtime/library").JsonValue | null;
            aiStatus: import("@prisma/client/runtime/library").JsonValue | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        duration: number | null;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        completedAt: Date | null;
        projectId: string;
        progress: number;
        currentStep: string | null;
        jobId: string | null;
        startedAt: Date | null;
    } & {
        findingCounts: import("./assessment-finding-counts").FindingCounts;
    })[]>;
    getDashboard(user: any): Promise<{
        findingsTrend: {
            weekStart: string;
            critical: number;
            high: number;
            medium: number;
            low: number;
            info: number;
        }[];
        findingsTrendPreviousTotal: number;
        scoreTrend: {
            month: string;
            averageScore: number;
            completedCount: number;
        }[];
        scoreTrendAverage: number;
        totalProjects: number;
        totalAssessments: number;
        avgSecurityScore: number;
        scoredProjects: number;
        unassessedProjects: number;
        findings: Record<string, number>;
        recentAssessments: ({
            summary: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                assessmentId: string;
                totalEndpoints: number;
                testedEndpoints: number;
                totalFindings: number;
                criticalCount: number;
                highCount: number;
                mediumCount: number;
                lowCount: number;
                infoCount: number;
                securityScore: number | null;
                scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
                scoreVersion: string | null;
                scoreComputedAt: Date | null;
                scoreExplanation: import("@prisma/client/runtime/library").JsonValue | null;
                riskLevel: string;
                plannedChecks: number;
                successfulChecks: number;
                failedChecks: number;
                skippedChecks: number;
                executionErrors: number;
                coveragePercent: number | null;
                owaspCoverage: import("@prisma/client/runtime/library").JsonValue | null;
                pluginResults: import("@prisma/client/runtime/library").JsonValue | null;
                aiStatus: import("@prisma/client/runtime/library").JsonValue | null;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            duration: number | null;
            status: import("@prisma/client").$Enums.AssessmentStatus;
            completedAt: Date | null;
            projectId: string;
            progress: number;
            currentStep: string | null;
            jobId: string | null;
            startedAt: Date | null;
        } & {
            findingCounts: import("./assessment-finding-counts").FindingCounts;
        })[];
    }>;
    findByProject(projectId: string, user: any, page?: string, pageSize?: string): Promise<{
        data: ({
            project: {
                id: string;
                name: string;
                baseUrl: string;
            };
            _count: {
                occurrences: number;
            };
            summary: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                assessmentId: string;
                totalEndpoints: number;
                testedEndpoints: number;
                totalFindings: number;
                criticalCount: number;
                highCount: number;
                mediumCount: number;
                lowCount: number;
                infoCount: number;
                securityScore: number | null;
                scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
                scoreVersion: string | null;
                scoreComputedAt: Date | null;
                scoreExplanation: import("@prisma/client/runtime/library").JsonValue | null;
                riskLevel: string;
                plannedChecks: number;
                successfulChecks: number;
                failedChecks: number;
                skippedChecks: number;
                executionErrors: number;
                coveragePercent: number | null;
                owaspCoverage: import("@prisma/client/runtime/library").JsonValue | null;
                pluginResults: import("@prisma/client/runtime/library").JsonValue | null;
                aiStatus: import("@prisma/client/runtime/library").JsonValue | null;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            duration: number | null;
            status: import("@prisma/client").$Enums.AssessmentStatus;
            completedAt: Date | null;
            projectId: string;
            progress: number;
            currentStep: string | null;
            jobId: string | null;
            startedAt: Date | null;
        } & {
            findingCounts: import("./assessment-finding-counts").FindingCounts;
        })[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    }>;
    findOne(id: string, user: any): Promise<{
        findingCounts: import("./assessment-finding-counts").FindingCounts;
        summary: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            assessmentId: string;
            totalEndpoints: number;
            testedEndpoints: number;
            totalFindings: number;
            criticalCount: number;
            highCount: number;
            mediumCount: number;
            lowCount: number;
            infoCount: number;
            securityScore: number | null;
            scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
            scoreVersion: string | null;
            scoreComputedAt: Date | null;
            scoreExplanation: import("@prisma/client/runtime/library").JsonValue | null;
            riskLevel: string;
            plannedChecks: number;
            successfulChecks: number;
            failedChecks: number;
            skippedChecks: number;
            executionErrors: number;
            coveragePercent: number | null;
            owaspCoverage: import("@prisma/client/runtime/library").JsonValue | null;
            pluginResults: import("@prisma/client/runtime/library").JsonValue | null;
            aiStatus: import("@prisma/client/runtime/library").JsonValue | null;
        };
        project: {
            id: string;
            name: string;
            baseUrl: string;
            environment: import("@prisma/client").$Enums.Environment;
        };
        config: {
            id: string;
            createdAt: Date;
            assessmentId: string;
            executionMode: string;
            scanProfileId: string | null;
            manualPlugins: string[];
            enableAiAnalysis: boolean;
            maxRequestsPerEndpoint: number;
            requestDelayMs: number;
            timeoutMs: number;
            resolvedPlugins: string[];
        };
        occurrences: ({
            issue: {
                id: string;
                status: import("@prisma/client").$Enums.IssueStatus;
                firstSeenAt: Date;
                lastSeenAt: Date;
                reopenCount: number;
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
        })[];
        reports: {
            id: string;
            type: import("@prisma/client").$Enums.ReportType;
            format: import("@prisma/client").$Enums.ReportFormat;
            title: string;
            version: number;
            assessmentId: string;
            fileName: string | null;
            filePath: string | null;
            fileSize: number | null;
            checksum: string | null;
            sourceSnapshot: string | null;
            generatorVersion: string | null;
            generatedAt: Date;
        }[];
        logs: {
            level: string;
            plugin: string | null;
            id: string;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            assessmentId: string;
            message: string;
            timestamp: Date;
        }[];
        id: string;
        createdAt: Date;
        updatedAt: Date;
        duration: number | null;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        completedAt: Date | null;
        projectId: string;
        progress: number;
        currentStep: string | null;
        jobId: string | null;
        startedAt: Date | null;
    }>;
    createAndRun(projectId: string, user: any, config: RunAssessmentDto): Promise<{
        config: {
            id: string;
            createdAt: Date;
            assessmentId: string;
            executionMode: string;
            scanProfileId: string | null;
            manualPlugins: string[];
            enableAiAnalysis: boolean;
            maxRequestsPerEndpoint: number;
            requestDelayMs: number;
            timeoutMs: number;
            resolvedPlugins: string[];
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        duration: number | null;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        completedAt: Date | null;
        projectId: string;
        progress: number;
        currentStep: string | null;
        jobId: string | null;
        startedAt: Date | null;
    }>;
    cancel(id: string, user: any): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        duration: number | null;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        completedAt: Date | null;
        projectId: string;
        progress: number;
        currentStep: string | null;
        jobId: string | null;
        startedAt: Date | null;
    }>;
    streamProgress(id: string, user: any): Promise<Observable<MessageEvent>>;
}
