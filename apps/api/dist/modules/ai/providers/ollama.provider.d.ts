import { ConfigService } from '@nestjs/config';
import type { AiCompletionRequest, AiCompletionResponse, AiProviderStatus, IAiProvider } from '../interfaces/ai-provider.interface';
export declare class OllamaProvider implements IAiProvider {
    private readonly configService;
    private readonly logger;
    readonly providerName = "ollama";
    readonly model: string;
    private readonly baseUrl;
    private readonly timeoutMs;
    constructor(configService: ConfigService);
    isAvailable(): boolean;
    getStatus(): AiProviderStatus;
    complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
