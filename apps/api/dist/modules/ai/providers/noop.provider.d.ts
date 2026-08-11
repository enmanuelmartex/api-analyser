import type { AiCompletionRequest, AiCompletionResponse, AiProviderStatus, IAiProvider } from '../interfaces/ai-provider.interface';
export declare class NoopAiProvider implements IAiProvider {
    readonly providerName = "none";
    readonly model = "none";
    isAvailable(): boolean;
    getStatus(): AiProviderStatus;
    complete(_request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
