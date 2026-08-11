import { AiService } from './ai.service';
import { AiConfigService, SaveProviderConfigDto, TestConnectionDto } from './ai-config.service';
import { AiUsageService } from './guidance/ai-usage.service';
export declare class AiController {
    private readonly aiService;
    private readonly aiConfigService;
    private readonly aiUsage;
    constructor(aiService: AiService, aiConfigService: AiConfigService, aiUsage: AiUsageService);
    getStatus(): Promise<import("./interfaces/ai-provider.interface").AiProviderStatus>;
    getUsage(): Promise<import("./guidance/ai-usage.service").AiUsageSummary>;
    getAllConfigs(): Promise<import("./ai-config.service").ProviderConfigResponseDto[]>;
    getEnvStatus(): import("./ai-config.service").EnvStatusDto;
    deactivateAll(): Promise<void>;
    getProviderConfig(provider: string): Promise<import("./ai-config.service").ProviderConfigResponseDto>;
    saveProviderConfig(provider: string, dto: SaveProviderConfigDto): Promise<import("./ai-config.service").ProviderConfigResponseDto>;
    activateProvider(provider: string): Promise<import("./ai-config.service").ProviderConfigResponseDto>;
    testProvider(provider: string, dto: TestConnectionDto): Promise<import("./ai-config.service").TestConnectionResult>;
    deleteProviderConfig(provider: string): Promise<void>;
}
