import { PrismaService } from '../../prisma/prisma.service';
import { type ScoreResult } from './score-engine';
export declare class ScoringService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    scoreAssessment(assessmentId: string): Promise<ScoreResult>;
    private loadScorableIssues;
    getProjectPosture(projectId: string): Promise<{
        currentSecurityScore: number;
        currentScoreStatus: import("@prisma/client").$Enums.ScoreStatus;
        currentScoreVersion: string;
        currentCoveragePercent: number;
        scoredAt: Date;
        assessmentId: string;
        reason: string;
    }>;
    getAssessmentScore(assessmentId: string, userId: string): Promise<{
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
}
