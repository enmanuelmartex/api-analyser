import type { Severity } from '@prisma/client';
export interface FindingCounts {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
}
export declare function emptyFindingCounts(): FindingCounts;
export interface OccurrenceSeverityGroup {
    assessmentId: string;
    severitySnapshot: Severity;
    _count: {
        _all: number;
    };
}
export interface OccurrenceSeverity {
    severitySnapshot: Severity;
}
export declare function countOccurrenceSeverities(occurrences: readonly OccurrenceSeverity[]): FindingCounts;
export declare function findingSummaryFields(counts: FindingCounts): {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    riskLevel: string;
};
export declare function riskLevelFor(counts: FindingCounts): string;
export declare function foldOccurrenceCounts(groups: OccurrenceSeverityGroup[]): Map<string, FindingCounts>;
