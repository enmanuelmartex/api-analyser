export interface AiCompletionRequest {
    userPrompt: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    jsonMode?: boolean;
}
export interface AiCompletionResponse {
    content: string;
    tokensUsed?: number;
}
export interface AiProviderStatus {
    provider: string;
    model: string;
    available: boolean;
    reason?: string;
}
export interface AiAnalysisConfig {
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    maxFindings: number;
    executiveSummary: boolean;
    analyzeCritical: boolean;
    analyzeHigh: boolean;
    analyzeMedium: boolean;
    analyzeLow: boolean;
}
export interface AiAnalysisMeta {
    provider: string;
    model: string;
    available: boolean;
    analyzed: number;
    skipped: number;
    durationMs: number;
    tokensUsed: number;
    reason?: string;
    status: 'completed' | 'skipped' | 'failed';
    errorMessage?: string;
}
export interface IAiProvider {
    readonly providerName: string;
    readonly model: string;
    isAvailable(): boolean;
    getStatus(): AiProviderStatus;
    complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
