import { PrismaService } from '../../prisma/prisma.service';
import { ScoringService } from './scoring.service';
import { ComparisonService } from './comparison.service';
export declare class ScoringController {
    private readonly scoring;
    private readonly comparison;
    private readonly prisma;
    constructor(scoring: ScoringService, comparison: ComparisonService, prisma: PrismaService);
    getAssessmentScore(id: string, user: any): Promise<{
        assessmentId: string;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        securityScore: number;
        scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
        scoreVersion: string;
        scoreComputedAt: Date;
        coveragePercent: number;
        coverage: {
            plannedChecks: number;
            successfulChecks: number;
            failedChecks: number;
            skippedChecks: number;
            executionErrors: number;
        };
        explanation: import("@prisma/client/runtime/library").JsonValue;
    }>;
    getProjectPosture(id: string, user: any): Promise<{
        currentSecurityScore: number;
        currentScoreStatus: import("@prisma/client").$Enums.ScoreStatus;
        currentScoreVersion: string;
        currentCoveragePercent: number;
        scoredAt: Date;
        assessmentId: string;
        reason: string;
    }>;
    compare(id: string, user: any, baseline?: string): Promise<{
        comparability: import("./comparison.service").Comparability;
        warnings: string[];
        current: {
            assessmentId: string;
            createdAt: Date;
            securityScore: number;
            scoreStatus: string;
            scoreVersion: string;
            coveragePercent: number;
            plannedChecks: number;
            successfulChecks: number;
            failedChecks: number;
            skippedChecks: number;
        };
        baseline: {
            assessmentId: string;
            createdAt: Date;
            securityScore: number;
            scoreStatus: string;
            scoreVersion: string;
            coveragePercent: number;
            plannedChecks: number;
            successfulChecks: number;
            failedChecks: number;
            skippedChecks: number;
        };
        scoreDelta: number;
        coverageDelta: number;
        changes: Record<import("./comparison.service").IssueChangeKind, any[]>;
        scopeChanges: {
            sharedChecks: string[];
            addedChecks: string[];
            removedChecks: string[];
        };
    }>;
    candidates(id: string, user: any): Promise<{
        id: string;
        createdAt: Date;
        summary: {
            securityScore: number;
            scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
            scoreVersion: string;
            coveragePercent: number;
        };
    }[]>;
}
