import { PrismaService } from '../../prisma/prisma.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';
import { type ReportFormat, type ReportType } from './report-artifact';
export interface ResolvedArtifact {
    bytes: Buffer;
    contentType: string;
    fileName: string;
    rehydrated: boolean;
}
export declare class ReportsService {
    private prisma;
    private generator;
    private storage;
    private readonly logger;
    constructor(prisma: PrismaService, generator: ReportGeneratorService, storage: ReportStorageService);
    findAll(userId: string, options?: {
        assessmentId?: string;
        includeHistory?: boolean;
    }): Promise<(Omit<{
        assessment: {
            project: {
                id: string;
                name: string;
            };
            id: string;
            completedAt: Date;
        };
    } & {
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
    }, "sourceSnapshot"> & {
        isDownloadable: boolean;
    })[]>;
    private latestVersionsOnly;
    findOne(id: string, userId: string): Promise<{
        assessment: {
            findingCounts: import("../assessments/assessment-finding-counts").FindingCounts;
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
            };
            id: string;
            duration: number;
            status: import("@prisma/client").$Enums.AssessmentStatus;
            completedAt: Date;
            occurrences: ({
                issue: {
                    id: string;
                    status: import("@prisma/client").$Enums.IssueStatus;
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
        };
        formats: ({
            format: ReportFormat;
            status: "MISSING";
            reportId: any;
            fileSize: any;
            generatedAt: any;
            version: any;
        } | {
            format: ReportFormat;
            status: "UNAVAILABLE" | "AVAILABLE";
            reportId: string;
            fileSize: number;
            generatedAt: Date;
            version: number;
        })[];
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
        generatorVersion: string | null;
        generatedAt: Date;
        isDownloadable: boolean;
    }>;
    findByAssessment(assessmentId: string, userId: string): Promise<(Omit<{
        assessment: {
            project: {
                id: string;
                name: string;
            };
            id: string;
            completedAt: Date;
        };
    } & {
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
    }, "sourceSnapshot"> & {
        isDownloadable: boolean;
    })[]>;
    formatAvailability(assessmentId: string, type: ReportType): Promise<({
        format: ReportFormat;
        status: "MISSING";
        reportId: any;
        fileSize: any;
        generatedAt: any;
        version: any;
    } | {
        format: ReportFormat;
        status: "UNAVAILABLE" | "AVAILABLE";
        reportId: string;
        fileSize: number;
        generatedAt: Date;
        version: number;
    })[]>;
    private artifactState;
    private withArtifactState;
    generate(assessmentId: string, userId: string, options: {
        type: ReportType;
        format: ReportFormat;
        regenerate?: boolean;
    }): Promise<{
        report: Omit<{
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
        }, "sourceSnapshot"> & {
            isDownloadable: boolean;
        };
        created: boolean;
    }>;
    private renderInto;
    private renderSnapshot;
    private materialise;
    private buildTitle;
    resolveArtifact(reportId: string, userId: string): Promise<ResolvedArtifact>;
    getStats(userId: string): Promise<{
        activeReportArtifacts: number;
        supersededReportArtifacts: number;
        activeArtifactsLast30Days: number;
        distinctAssessmentsWithReports: number;
        totalCompletedAssessments: number;
        distinctProjectsCovered: number;
        totalActiveProjects: number;
        averageAssessmentScore: number;
        scoredAssessmentsInAverage: number;
        averageScoreDelta: import("./report-metrics").ScoreDelta;
        criticalFindingsIncluded: number;
        highFindingsIncluded: number;
        mediumFindingsIncluded: number;
        lowFindingsIncluded: number;
        infoFindingsIncluded: number;
        totalFindingsIncluded: number;
        criticalHighFindingsIncluded: number;
        vulnerabilityTrend: import("./report-metrics").ReportTrendPoint[];
        vulnerabilityTrendDelta: import("./report-metrics").TrendDelta;
        trendWindowDays: number;
    }>;
    remove(id: string, userId: string): Promise<{
        message: string;
    }>;
    private assertAssessmentAccess;
}
