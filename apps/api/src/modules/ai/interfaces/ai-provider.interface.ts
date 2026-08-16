// =============================================================================
// AI Provider Abstraction Layer
// The scanner interacts ONLY with IAiProvider — never with a concrete SDK.
// =============================================================================

export interface AiCompletionRequest {
  userPrompt: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  /** Request JSON output where the provider supports it natively. */
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
  /** Human-readable reason when available === false */
  reason?: string;
  /**
   * Providers holding a credential, active or not — names only, no secrets.
   *
   * Only the instance-level status (`GET /ai/status`) fills this in; a single
   * provider cannot know what its siblings have configured.
   */
  configuredProviders?: string[];
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
  provider:      string;
  model:         string;
  available:     boolean;
  analyzed:      number;
  skipped:       number;
  durationMs:    number;
  tokensUsed:    number;
  reason?:       string;
  /** Execution outcome: completed (ran), skipped (disabled / no provider), failed (provider error) */
  status:        'completed' | 'skipped' | 'failed';
  /** Provider error detail when status === 'failed' */
  errorMessage?: string;
}

export interface IAiProvider {
  readonly providerName: string;
  readonly model: string;
  isAvailable(): boolean;
  getStatus(): AiProviderStatus;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
