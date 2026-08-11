import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
export interface SaveProviderConfigDto {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    profile?: 'minimal' | 'balanced' | 'complete' | 'custom';
    analyzeCritical?: boolean;
    analyzeHigh?: boolean;
    analyzeMedium?: boolean;
    analyzeLow?: boolean;
    executiveSummary?: boolean;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxFindings?: number;
    retryAttempts?: number;
}
export interface TestConnectionDto {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
}
export interface TestConnectionResult {
    success: boolean;
    message: string;
    latencyMs?: number;
    model?: string;
}
export interface ProviderConfigResponseDto {
    provider: string;
    model: string;
    maskedKey?: string;
    hasKey: boolean;
    baseUrl?: string;
    isActive: boolean;
    profile: string;
    analyzeCritical: boolean;
    analyzeHigh: boolean;
    analyzeMedium: boolean;
    analyzeLow: boolean;
    executiveSummary: boolean;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    maxFindings: number;
    retryAttempts: number;
    configSource: 'database' | 'environment' | 'defaults';
    lastTestedAt?: string;
    lastTestSuccess?: boolean;
    lastTestMessage?: string;
    configuredAt?: string;
    envHasKey: boolean;
    envModel?: string;
}
export interface AiEffectiveConfig {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    maxFindings: number;
    retryAttempts: number;
    executiveSummary: boolean;
    analyzeCritical: boolean;
    analyzeHigh: boolean;
    analyzeMedium: boolean;
    analyzeLow: boolean;
    configSource: 'database' | 'environment' | 'defaults';
}
export interface EnvStatusDto {
    openai: {
        apiKey: boolean;
        model: string;
    };
    grok: {
        apiKey: boolean;
        model: string;
    };
    claude: {
        apiKey: boolean;
        model: string;
    };
    gemini: {
        apiKey: boolean;
        model: string;
    };
    ollama: {
        baseUrl: string;
        model: string;
    };
    activeProvider: string;
}
export declare const ALL_PROVIDERS: readonly ["openai", "grok", "claude", "gemini", "ollama"];
export type ProviderName = (typeof ALL_PROVIDERS)[number];
export declare const PROVIDER_DEFAULTS: Record<string, Partial<AiEffectiveConfig>>;
export declare class AiConfigService {
    private readonly prisma;
    private readonly configService;
    private readonly crypto;
    private readonly logger;
    constructor(prisma: PrismaService, configService: ConfigService, crypto: CryptoService);
    getAllConfigs(): Promise<ProviderConfigResponseDto[]>;
    getProviderConfig(provider: string): Promise<ProviderConfigResponseDto>;
    saveProviderConfig(provider: string, dto: SaveProviderConfigDto): Promise<ProviderConfigResponseDto>;
    activateProvider(provider: string): Promise<ProviderConfigResponseDto>;
    deactivateAll(): Promise<void>;
    testProvider(provider: string, dto: TestConnectionDto): Promise<TestConnectionResult>;
    deleteProviderConfig(provider: string): Promise<void>;
    getEffectiveConfig(): Promise<AiEffectiveConfig>;
    getEnvStatus(): EnvStatusDto;
    buildShimConfigService(provider: string, apiKey?: string, model?: string, baseUrl?: string, timeoutMs?: number): any;
    private buildResponseDto;
    private resolveFromEnv;
    private buildTransientProvider;
    private maskKey;
    private describeError;
    private encrypt;
    private decrypt;
}
