import { PrismaService } from '../../prisma/prisma.service';
export type Comparability = 'COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';
export type IssueChangeKind = 'NEW' | 'PERSISTING' | 'RESOLVED' | 'REOPENED' | 'NOT_TESTED' | 'OUT_OF_SCOPE';
export declare class ComparisonService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getComparisonCandidates(assessmentId: string, userId: string): Promise<{
        id: string;
        createdAt: Date;
        summary: {
            securityScore: number;
            scoreStatus: import("@prisma/client").$Enums.ScoreStatus;
            scoreVersion: string;
            coveragePercent: number;
        };
    }[]>;
    compare(assessmentId: string, userId: string, baselineId?: string): Promise<{
        comparability: Comparability;
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
        changes: Record<IssueChangeKind, any[]>;
        scopeChanges: {
            sharedChecks: string[];
            addedChecks: string[];
            removedChecks: string[];
        };
    }>;
    private loadSide;
    private findPreviousSide;
    private toSide;
    private publicSide;
    private assessComparability;
    private classifyChanges;
    private loadOccurrenceIdentities;
}
