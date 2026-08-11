export declare class RunAssessmentDto {
    executionMode?: 'all' | 'profile' | 'manual';
    scanProfileId?: string;
    manualPlugins?: string[];
    enableAiAnalysis?: boolean;
    maxRequestsPerEndpoint?: number;
    requestDelayMs?: number;
    timeoutMs?: number;
}
