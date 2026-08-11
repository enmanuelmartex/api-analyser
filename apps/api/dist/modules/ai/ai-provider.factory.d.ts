import { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';
import { OpenAiProvider } from './providers/openai.provider';
import { GrokProvider } from './providers/grok.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { NoopAiProvider } from './providers/noop.provider';
import type { IAiProvider } from './interfaces/ai-provider.interface';
export declare class AiProviderFactory {
    private readonly configService;
    private readonly aiConfigService;
    private readonly openAi;
    private readonly grok;
    private readonly claude;
    private readonly gemini;
    private readonly ollama;
    private readonly noop;
    private readonly logger;
    constructor(configService: ConfigService, aiConfigService: AiConfigService, openAi: OpenAiProvider, grok: GrokProvider, claude: ClaudeProvider, gemini: GeminiProvider, ollama: OllamaProvider, noop: NoopAiProvider);
    getProvider(): Promise<IAiProvider>;
    getProviderStatus(): Promise<import("./interfaces/ai-provider.interface").AiProviderStatus>;
    private getEnvProvider;
}
