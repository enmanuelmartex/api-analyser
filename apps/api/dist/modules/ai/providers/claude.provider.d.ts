import { ConfigService } from '@nestjs/config';
import type { AiCompletionRequest, AiCompletionResponse, AiProviderStatus, IAiProvider } from '../interfaces/ai-provider.interface';
export declare class ClaudeProvider implements IAiProvider {
    private readonly configService;
    private readonly logger;
    readonly providerName = "claude";
    readonly model: string;
    private client;
    private unavailableReason?;
    constructor(configService: ConfigService);
    isAvailable(): boolean;
    getStatus(): AiProviderStatus;
    complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}
