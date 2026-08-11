export interface ReportedAssessment {
    id: string;
    projectId: string;
    completedAt: Date;
    securityScore: number | null;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
}
export interface ReportTrendPoint {
    date: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
    scans: number;
}
export interface TrendDelta {
    current: number;
    previous: number;
    changePercent: number;
    direction: 'up' | 'down' | 'flat';
}
export interface ScoreDelta {
    currentAverage: number;
    previousAverage: number;
    deltaPoints: number;
    deltaPercent: number | null;
    direction: 'up' | 'down' | 'flat';
    currentSampleSize: number;
    previousSampleSize: number;
}
export interface SeverityTotals {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    totalFindings: number;
}
export declare function emptySeverityTotals(): SeverityTotals;
export declare function sumSeverities(assessments: ReportedAssessment[]): SeverityTotals;
export declare function averageScore(assessments: ReportedAssessment[]): {
    avgSecurityScore: number | null;
    scoredAssessments: number;
};
export declare function averageScoreDelta(assessments: ReportedAssessment[], windowDays: number, now?: Date): ScoreDelta | null;
export declare function buildTrend(assessments: ReportedAssessment[], windowDays: number, now?: Date): ReportTrendPoint[];
export declare function trendDelta(points: ReportTrendPoint[]): TrendDelta | null;
