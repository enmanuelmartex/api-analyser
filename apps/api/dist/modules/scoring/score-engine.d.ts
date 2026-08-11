import type { Severity } from '@prisma/client';
export declare const SCORE_VERSION = "score-v2";
export declare const MIN_SECURITY_SCORE = 1;
export declare const SEVERITY_WEIGHTS: Record<Severity, number>;
export declare const MAX_EXPOSURE_MULTIPLIER = 2;
export declare const MAX_TOTAL_PENALTY = 100;
export type ScoreStatus = 'UNAVAILABLE' | 'PROVISIONAL' | 'FINAL';
export interface ScorableIssue {
    fingerprint: string;
    pluginId: string;
    ruleId: string;
    severity: Severity;
    method: string;
    normalizedRoute: string;
    component: string;
}
export interface CoverageInput {
    plannedChecks: number;
    successfulChecks: number;
    failedChecks: number;
    skippedChecks: number;
    executionErrors: number;
}
export interface ScoreInput {
    assessmentStatus: string;
    issues: ScorableIssue[];
    coverage: CoverageInput;
}
export interface RuleManifestation {
    fingerprint: string;
    component: string;
    severity: Severity;
}
export interface RulePenalty {
    pluginId: string;
    ruleId: string;
    aggregationKey: string;
    highestSeverity: Severity;
    severityWeight: number;
    fingerprints: string[];
    fingerprintCount: number;
    affectedComponents: string[];
    distinctAffectedComponents: number;
    exposureMultiplier: number;
    rulePenalty: number;
    manifestations: RuleManifestation[];
}
export interface ScoreResult {
    scoreVersion: string;
    securityScore: number | null;
    scoreStatus: ScoreStatus;
    coveragePercent: number | null;
    totalPenalty: number;
    uncappedPenalty: number;
    severityBreakdown: Record<Severity, number>;
    rulePenalties: RulePenalty[];
    reasons: string[];
    weights: Record<Severity, number>;
    issuesConsidered: number;
    coverage: CoverageInput;
}
export declare function componentKey(issue: ScorableIssue): string;
export declare function aggregationKey(issue: Pick<ScorableIssue, 'pluginId' | 'ruleId'>): string;
export declare function exposureMultiplier(distinctAffectedComponents: number): number;
export declare function computeScore(input: ScoreInput): ScoreResult;
