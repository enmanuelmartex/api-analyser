export declare const GUIDANCE_SCHEMA_VERSION = "guidance-v1";
export type GuidancePriority = 'IMMEDIATE' | 'SHORT_TERM' | 'PLANNED';
export type ContextConfidence = 'DETECTED' | 'USER_CONFIGURED' | 'INFERRED' | 'UNKNOWN';
export interface RemediationStep {
    title: string;
    description: string;
}
export interface EnvironmentGuidance {
    technology: string;
    basis: ContextConfidence;
    guidance: string;
    example?: string;
}
export interface GuidanceReference {
    title: string;
    source: string;
    url?: string;
}
export interface SecurityGuidance {
    schemaVersion: string;
    summary: string;
    rootCause: string;
    businessImpact: string;
    technicalImpact: string;
    remediation: {
        priority: GuidancePriority;
        steps: RemediationStep[];
    };
    environmentGuidance: EnvironmentGuidance[];
    verification: {
        steps: string[];
        expectedResult: string;
    };
    falsePositiveConsiderations: string[];
    references: GuidanceReference[];
    confidence: number | null;
}
export type GuidanceParseResult = {
    ok: true;
    guidance: SecurityGuidance;
    droppedFields: string[];
} | {
    ok: false;
    errorCode: GuidanceParseError;
    message: string;
};
export type GuidanceParseError = 'EMPTY_RESPONSE' | 'NOT_JSON' | 'NOT_AN_OBJECT' | 'MISSING_REQUIRED_FIELDS';
export declare function parseSecurityGuidance(raw: string | null | undefined, options?: {
    allowedTechnologies?: Map<string, ContextConfidence>;
}): GuidanceParseResult;
