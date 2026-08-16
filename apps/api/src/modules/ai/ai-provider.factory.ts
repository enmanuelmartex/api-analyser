import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';
import { OpenAiProvider } from './providers/openai.provider';
import { GrokProvider } from './providers/grok.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { NoopAiProvider } from './providers/noop.provider';
import type { IAiProvider } from './interfaces/ai-provider.interface';

/**
 * Resolves the active IAiProvider using a DB → env → default priority chain.
 *
 * When a DB configuration exists, provider instances are created dynamically
 * with the stored (decrypted) credentials. This allows runtime reconfiguration
 * without a container restart.
 *
 * Falls back to environment-variable-based DI-managed providers if the DB
 * is unavailable or no DB config has been saved.
 */
@Injectable()
export class AiProviderFactory {
  private readonly logger = new Logger(AiProviderFactory.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly aiConfigService: AiConfigService,
    // DI-managed env-var providers — used as a fallback path
    private readonly openAi: OpenAiProvider,
    private readonly grok: GrokProvider,
    private readonly claude: ClaudeProvider,
    private readonly gemini: GeminiProvider,
    private readonly ollama: OllamaProvider,
    private readonly noop: NoopAiProvider,
  ) {}

  /** Returns the active IAiProvider. Priority: DB config → env vars → noop. */
  async getProvider(): Promise<IAiProvider> {
    try {
      const config = await this.aiConfigService.getEffectiveConfig();

      if (!config || config.provider === 'none') return this.noop;

      const shim = this.aiConfigService.buildShimConfigService(
        config.provider,
        config.apiKey,
        config.model,
        config.baseUrl,
        config.timeoutMs,
      );

      let provider: IAiProvider;
      switch (config.provider) {
        case 'openai': provider = new OpenAiProvider(shim); break;
        case 'grok':   provider = new GrokProvider(shim);   break;
        case 'claude': provider = new ClaudeProvider(shim); break;
        case 'gemini': provider = new GeminiProvider(shim); break;
        case 'ollama': provider = new OllamaProvider(shim); break;
        default:
          this.logger.warn(`Unknown AI provider "${config.provider}" — falling back to noop`);
          return this.noop;
      }

      if (!provider.isAvailable()) {
        this.logger.warn(
          `Provider "${config.provider}" unavailable (${provider.getStatus().reason}) — AI analysis will be skipped`,
        );
        return this.noop;
      }

      return provider;
    } catch (error: any) {
      this.logger.warn(
        `Failed to resolve provider from config service (${error?.message}) — falling back to env vars`,
      );
      return this.getEnvProvider();
    }
  }

  /**
   * A quick status, without making network calls.
   *
   * `configuredProviders` is the part the scan UI needs and the provider itself
   * cannot answer: whether a credential exists *somewhere* even though nothing
   * is active. Without it, "no provider is configured" and "you saved a key but
   * never activated it" are the same sentence, and only one of them is fixed by
   * entering another key.
   */
  async getProviderStatus() {
    try {
      const [config, configuredProviders] = await Promise.all([
        this.aiConfigService.getEffectiveConfig(),
        this.aiConfigService.listConfiguredProviders().catch(() => [] as string[]),
      ]);

      const hasCredential = Boolean(config.apiKey) || config.provider === 'ollama';
      return {
        provider:  config.provider,
        model:     config.model,
        available: config.provider !== 'none' && hasCredential,
        reason:    config.provider === 'none'
          ? 'AI analysis is disabled'
          : !hasCredential
            ? `No API key configured for ${config.provider}`
            : undefined,
        configuredProviders,
      };
    } catch {
      return { ...this.getEnvProvider().getStatus(), configuredProviders: [] as string[] };
    }
  }

  // ── Fallback: original env-var behavior ──────────────────────────────────────

  private getEnvProvider(): IAiProvider {
    const name = this.configService.get<string>('ai.provider', 'openai').toLowerCase();
    const map: Record<string, IAiProvider> = {
      openai: this.openAi,
      grok:   this.grok,
      claude: this.claude,
      gemini: this.gemini,
      ollama: this.ollama,
      none:   this.noop,
    };
    const provider = map[name] ?? this.noop;
    if (!provider.isAvailable() && provider !== this.noop) {
      this.logger.warn(`Env-var provider "${name}" has no API key — using noop`);
      return this.noop;
    }
    return provider;
  }
}
