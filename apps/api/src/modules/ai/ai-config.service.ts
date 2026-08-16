import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { IAiProvider } from './interfaces/ai-provider.interface';
import { OpenAiProvider } from './providers/openai.provider';
import { GrokProvider } from './providers/grok.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OllamaProvider } from './providers/ollama.provider';

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface SaveProviderConfigDto {
  model?: string;
  apiKey?: string;   // '' = keep existing; new value = replace
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
  envHasKey: boolean;      // whether env var key exists for this provider
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
  openai: { apiKey: boolean; model: string };
  grok:   { apiKey: boolean; model: string };
  claude: { apiKey: boolean; model: string };
  gemini: { apiKey: boolean; model: string };
  ollama: { baseUrl: string; model: string };
  activeProvider: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const ALL_PROVIDERS = ['openai', 'grok', 'claude', 'gemini', 'ollama'] as const;
export type ProviderName = (typeof ALL_PROVIDERS)[number];

const PROFILE_PRESETS: Record<string, Partial<SaveProviderConfigDto>> = {
  minimal:  { analyzeCritical: true, analyzeHigh: false, analyzeMedium: false, analyzeLow: false, executiveSummary: true },
  balanced: { analyzeCritical: true, analyzeHigh: true,  analyzeMedium: false, analyzeLow: false, executiveSummary: true },
  complete: { analyzeCritical: true, analyzeHigh: true,  analyzeMedium: true,  analyzeLow: true,  executiveSummary: true },
};

export const PROVIDER_DEFAULTS: Record<string, Partial<AiEffectiveConfig>> = {
  openai:  { model: 'gpt-4o-mini',              maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  grok:    { model: 'llama-3.3-70b-versatile',   maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  claude:  { model: 'claude-haiku-4-5-20251001', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  gemini:  { model: 'gemini-2.5-flash',           maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  ollama:  { model: 'llama3.2:3b',               maxTokens: 1000, temperature: 0.2, timeoutMs: 60000, maxFindings: 5  },
};

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Returns all 5 providers with their current DB + env status. */
  async getAllConfigs(): Promise<ProviderConfigResponseDto[]> {
    const rows = await this.prisma.aiProviderConfig.findMany();
    const rowMap = new Map(rows.map((r) => [r.provider, r]));

    return Promise.all(
      ALL_PROVIDERS.map((p) => this.buildResponseDto(p, rowMap.get(p) ?? null)),
    );
  }

  /** Returns a single provider's config. */
  async getProviderConfig(provider: string): Promise<ProviderConfigResponseDto> {
    const row = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
    return this.buildResponseDto(provider, row);
  }

  /** Saves config for one provider. Does NOT change which provider is active. */
  async saveProviderConfig(provider: string, dto: SaveProviderConfigDto): Promise<ProviderConfigResponseDto> {
    const existing = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
    const defaults  = PROVIDER_DEFAULTS[provider] ?? {};
    const profile   = dto.profile ?? existing?.profile ?? 'balanced';
    const preset    = PROFILE_PRESETS[profile];

    const analyzeCritical  = profile === 'custom' ? (dto.analyzeCritical  ?? existing?.analyzeCritical  ?? true)  : (preset?.analyzeCritical  ?? true);
    const analyzeHigh      = profile === 'custom' ? (dto.analyzeHigh      ?? existing?.analyzeHigh      ?? true)  : (preset?.analyzeHigh      ?? true);
    const analyzeMedium    = profile === 'custom' ? (dto.analyzeMedium    ?? existing?.analyzeMedium    ?? false) : (preset?.analyzeMedium    ?? false);
    const analyzeLow       = profile === 'custom' ? (dto.analyzeLow       ?? existing?.analyzeLow       ?? false) : (preset?.analyzeLow       ?? false);
    const executiveSummary = profile === 'custom' ? (dto.executiveSummary ?? existing?.executiveSummary ?? true)  : (preset?.executiveSummary ?? true);

    let encryptedKey: string | null = existing?.apiKey ?? null;
    if (dto.apiKey && dto.apiKey.trim()) {
      encryptedKey = await this.encrypt(dto.apiKey.trim());
    }

    const data: any = {
      model:           dto.model   ?? existing?.model   ?? defaults.model  ?? null,
      apiKey:          encryptedKey,
      baseUrl:         dto.baseUrl !== undefined ? (dto.baseUrl || null) : (existing?.baseUrl ?? null),
      profile,
      analyzeCritical,
      analyzeHigh,
      analyzeMedium,
      analyzeLow,
      executiveSummary,
      maxTokens:       dto.maxTokens    ?? existing?.maxTokens    ?? null,
      temperature:     dto.temperature  ?? existing?.temperature  ?? null,
      timeoutMs:       dto.timeoutMs    ?? existing?.timeoutMs    ?? null,
      maxFindings:     dto.maxFindings  ?? existing?.maxFindings  ?? null,
      retryAttempts:   dto.retryAttempts ?? existing?.retryAttempts ?? 2,
    };

    await this.prisma.aiProviderConfig.upsert({
      where:  { provider },
      create: { provider, isActive: false, ...data },
      update: data,
    });

    this.logger.log(`Saved config for provider=${provider}, profile=${profile}`);
    return this.getProviderConfig(provider);
  }

  /**
   * Sets one provider as active. Only one can be active at a time.
   * The provider must already have a DB row (i.e. be configured).
   */
  async activateProvider(provider: string): Promise<ProviderConfigResponseDto> {
    await this.prisma.$transaction([
      this.prisma.aiProviderConfig.updateMany({ where: { isActive: true },          data: { isActive: false } }),
      this.prisma.aiProviderConfig.upsert({
        where:  { provider },
        create: { provider, isActive: true },
        update: { isActive: true },
      }),
    ]);

    this.logger.log(`Activated AI provider: ${provider}`);
    return this.getProviderConfig(provider);
  }

  /** Deactivates all providers (sets AI to "none"). */
  async deactivateAll(): Promise<void> {
    await this.prisma.aiProviderConfig.updateMany({ where: { isActive: true }, data: { isActive: false } });
    this.logger.log('All AI providers deactivated');
  }

  /** Tests a provider connection. Persists the test result to DB. */
  async testProvider(provider: string, dto: TestConnectionDto): Promise<TestConnectionResult> {
    const existing = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
    const defaults  = PROVIDER_DEFAULTS[provider] ?? {};
    const start     = Date.now();

    // Resolve API key: use provided plaintext → fall back to DB encrypted
    let apiKey = dto.apiKey?.trim();
    if (!apiKey && existing?.apiKey) {
      apiKey = await this.decrypt(existing.apiKey);
    }
    if (!apiKey) {
      apiKey = this.configService.get<string>(`ai.${provider}.apiKey`);
    }

    const model   = dto.model   ?? existing?.model   ?? defaults.model;
    const baseUrl = dto.baseUrl ?? existing?.baseUrl ?? undefined;

    let result: TestConnectionResult;
    try {
      const testProvider = this.buildTransientProvider(provider, apiKey, model, baseUrl);

      if (!testProvider.isAvailable()) {
        result = {
          success: false,
          message: testProvider.getStatus().reason || 'Provider not available. Check the API key.',
        };
      } else {
        await testProvider.complete({
          userPrompt:   'Reply with exactly: {"ok":true}',
          systemPrompt: 'You are a test responder. Return ONLY valid JSON.',
          maxTokens:    50,
          temperature:  0,
          jsonMode:     true,
        });
        const latencyMs = Date.now() - start;
        result = { success: true, message: `Connected to ${provider} in ${latencyMs}ms.`, latencyMs, model };
      }
    } catch (error: any) {
      result = { success: false, message: this.describeError(error), latencyMs: Date.now() - start };
    }

    // Persist test result regardless of outcome
    await this.prisma.aiProviderConfig.upsert({
      where:  { provider },
      create: { provider, isActive: false, lastTestedAt: new Date(), lastTestSuccess: result.success, lastTestMessage: result.message },
      update: { lastTestedAt: new Date(), lastTestSuccess: result.success, lastTestMessage: result.message },
    });

    return result;
  }

  /** Removes DB config for one provider. Falls back to env vars for that provider. */
  async deleteProviderConfig(provider: string): Promise<void> {
    await this.prisma.aiProviderConfig.deleteMany({ where: { provider } });
    this.logger.log(`Removed DB config for provider=${provider}`);
  }

  /**
   * Providers that hold a usable credential, whether or not one is active.
   *
   * Exists for `GET /ai/status`, so the scan UI can tell two very different
   * situations apart: nobody ever set AI up, versus a key was saved and nobody
   * pressed "Set as active". Both leave the effective provider at `none` and
   * both used to produce the same shrug of a message, which is how an operator
   * ends up staring at a configured provider wondering why every scan skips
   * enrichment.
   *
   * Names only — never keys, never masked keys — because this feeds an endpoint
   * every authenticated user can call.
   */
  async listConfiguredProviders(): Promise<string[]> {
    const rows = await this.prisma.aiProviderConfig.findMany({
      select: { provider: true, apiKey: true },
    });

    // Ollama authenticates with nothing at all, so a saved row is itself the
    // credential. Every other provider needs a stored key to count.
    const fromDb = rows
      .filter((row) => Boolean(row.apiKey) || row.provider === 'ollama')
      .map((row) => row.provider);

    // Env keys count too: an instance configured entirely through env vars has
    // no rows at all, and telling that operator "nothing is configured" would
    // be false.
    const fromEnv = ['openai', 'grok', 'claude', 'gemini'].filter((provider) =>
      Boolean(this.configService.get<string>(`ai.${provider}.apiKey`)),
    );

    return [...new Set([...fromDb, ...fromEnv])];
  }

  /**
   * Resolves effective config for the scanner (DB active row → env → defaults).
   * Returns plaintext API key.
   */
  async getEffectiveConfig(): Promise<AiEffectiveConfig> {
    const active = await this.prisma.aiProviderConfig.findFirst({ where: { isActive: true } });

    if (active) {
      const apiKey   = active.apiKey ? await this.decrypt(active.apiKey) : undefined;
      const defaults = PROVIDER_DEFAULTS[active.provider] ?? {};

      return {
        provider:         active.provider,
        model:            active.model       ?? defaults.model       ?? 'gpt-4o-mini',
        apiKey,
        baseUrl:          active.baseUrl     ?? undefined,
        maxTokens:        active.maxTokens   ?? defaults.maxTokens   ?? 2000,
        temperature:      active.temperature ?? defaults.temperature ?? 0.2,
        timeoutMs:        active.timeoutMs   ?? defaults.timeoutMs   ?? 30000,
        maxFindings:      active.maxFindings ?? defaults.maxFindings ?? 10,
        retryAttempts:    active.retryAttempts ?? 2,
        executiveSummary: active.executiveSummary,
        analyzeCritical:  active.analyzeCritical,
        analyzeHigh:      active.analyzeHigh,
        analyzeMedium:    active.analyzeMedium,
        analyzeLow:       active.analyzeLow,
        configSource:     'database',
      };
    }

    return this.resolveFromEnv();
  }

  /** Returns which env vars are configured (for the admin env status panel). */
  getEnvStatus(): EnvStatusDto {
    return {
      openai: { apiKey: Boolean(this.configService.get<string>('ai.openai.apiKey')), model: this.configService.get<string>('ai.openai.model', 'gpt-4o-mini') },
      grok:   { apiKey: Boolean(this.configService.get<string>('ai.grok.apiKey')),   model: this.configService.get<string>('ai.grok.model', 'llama-3.3-70b-versatile') },
      claude: { apiKey: Boolean(this.configService.get<string>('ai.claude.apiKey')), model: this.configService.get<string>('ai.claude.model', 'claude-haiku-4-5-20251001') },
      gemini: { apiKey: Boolean(this.configService.get<string>('ai.gemini.apiKey')), model: this.configService.get<string>('ai.gemini.model', 'gemini-2.5-flash') },
      ollama: { baseUrl: this.configService.get<string>('ai.ollama.baseUrl', 'http://localhost:11434'), model: this.configService.get<string>('ai.ollama.model', 'llama3') },
      activeProvider: this.configService.get<string>('ai.provider', 'none'),
    };
  }

  // ── Build a shim ConfigService for dynamic provider instantiation ─────────────

  buildShimConfigService(provider: string, apiKey?: string, model?: string, baseUrl?: string, timeoutMs?: number): any {
    const values: Record<string, any> = {
      [`ai.${provider}.apiKey`]:    apiKey    ?? '',
      [`ai.${provider}.model`]:     model     ?? PROVIDER_DEFAULTS[provider]?.model ?? 'gpt-4o-mini',
      [`ai.${provider}.timeoutMs`]: timeoutMs ?? PROVIDER_DEFAULTS[provider]?.timeoutMs ?? 30000,
      'ai.ollama.baseUrl':          baseUrl   ?? this.configService.get('ai.ollama.baseUrl', 'http://localhost:11434'),
      'ai.ollama.model':            model     ?? PROVIDER_DEFAULTS['ollama']?.model ?? 'llama3',
    };
    return {
      get: <T>(key: string, defaultVal?: T): T =>
        (key in values ? values[key] : defaultVal) as T,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async buildResponseDto(provider: string, row: any | null): Promise<ProviderConfigResponseDto> {
    const defaults  = PROVIDER_DEFAULTS[provider] ?? {};
    const envApiKey = this.configService.get<string>(`ai.${provider}.apiKey`);
    const envModel  = provider === 'ollama'
      ? this.configService.get<string>('ai.ollama.baseUrl', 'http://localhost:11434')
      : this.configService.get<string>(`ai.${provider}.model`, defaults.model as string);

    const configSource: 'database' | 'environment' | 'defaults' = row ? 'database'
      : (envApiKey || provider === 'ollama') ? 'environment'
      : 'defaults';

    const hasKey = Boolean(row?.apiKey) || Boolean(envApiKey) || provider === 'ollama';
    let maskedKey: string | undefined;
    if (row?.apiKey) {
      maskedKey = this.maskKey(await this.decrypt(row.apiKey));
    } else if (envApiKey) {
      maskedKey = this.maskKey(envApiKey);
    }

    return {
      provider,
      model:           row?.model        ?? defaults.model        ?? 'gpt-4o-mini',
      maskedKey,
      hasKey,
      baseUrl:         row?.baseUrl      ?? undefined,
      isActive:        row?.isActive     ?? false,
      profile:         row?.profile      ?? 'balanced',
      analyzeCritical: row?.analyzeCritical  ?? true,
      analyzeHigh:     row?.analyzeHigh      ?? true,
      analyzeMedium:   row?.analyzeMedium    ?? false,
      analyzeLow:      row?.analyzeLow       ?? false,
      executiveSummary: row?.executiveSummary ?? true,
      maxTokens:       row?.maxTokens    ?? defaults.maxTokens    ?? 2000,
      temperature:     row?.temperature  ?? defaults.temperature  ?? 0.2,
      timeoutMs:       row?.timeoutMs    ?? defaults.timeoutMs    ?? 30000,
      maxFindings:     row?.maxFindings  ?? defaults.maxFindings  ?? 10,
      retryAttempts:   row?.retryAttempts ?? 2,
      configSource,
      lastTestedAt:    row?.lastTestedAt?.toISOString(),
      lastTestSuccess: row?.lastTestSuccess ?? undefined,
      lastTestMessage: row?.lastTestMessage ?? undefined,
      configuredAt:    row?.configuredAt?.toISOString(),
      envHasKey:       Boolean(envApiKey) || provider === 'ollama',
      envModel,
    };
  }

  private resolveFromEnv(): AiEffectiveConfig {
    const providerName = this.configService.get<string>('ai.provider', 'none').toLowerCase();
    const cfg          = this.configService.get<any>(`ai.${providerName}`) ?? {};
    const defaults     = PROVIDER_DEFAULTS[providerName] ?? {};

    return {
      provider:         providerName,
      model:            cfg.model       ?? defaults.model       ?? 'gpt-4o-mini',
      apiKey:           cfg.apiKey      || undefined,
      baseUrl:          cfg.baseUrl     || undefined,
      maxTokens:        cfg.maxTokens   ?? defaults.maxTokens   ?? 2000,
      temperature:      cfg.temperature ?? defaults.temperature ?? 0.2,
      timeoutMs:        cfg.timeoutMs   ?? defaults.timeoutMs   ?? 30000,
      maxFindings:      cfg.maxFindings ?? defaults.maxFindings ?? 10,
      retryAttempts:    2,
      executiveSummary: cfg.executiveSummary ?? true,
      analyzeCritical:  cfg.analyzeCritical  ?? true,
      analyzeHigh:      cfg.analyzeHigh      ?? true,
      analyzeMedium:    cfg.analyzeMedium    ?? false,
      analyzeLow:       cfg.analyzeLow       ?? false,
      configSource: providerName !== 'none' && (cfg.apiKey || providerName === 'ollama')
        ? 'environment'
        : 'defaults',
    };
  }

  private buildTransientProvider(provider: string, apiKey?: string, model?: string, baseUrl?: string): IAiProvider {
    const shim = this.buildShimConfigService(provider, apiKey, model, baseUrl);
    switch (provider) {
      case 'openai': return new OpenAiProvider(shim);
      case 'grok':   return new GrokProvider(shim);
      case 'claude': return new ClaudeProvider(shim);
      case 'gemini': return new GeminiProvider(shim);
      case 'ollama': return new OllamaProvider(shim);
      default:       throw new Error(`Unknown AI provider: "${provider}"`);
    }
  }

  private maskKey(key: string): string {
    if (!key || key.length < 8) return '••••••••••••';
    const prefix = key.startsWith('sk-') ? 'sk-' : key.slice(0, 2);
    const suffix = key.slice(-4);
    return `${prefix}${'•'.repeat(12)}${suffix}`;
  }

  private describeError(error: any): string {
    const raw: string = error?.message || String(error);
    const msg = raw.replace(/^(\d{3})\s+"(.+)"$/, '$1 $2');
    const lo  = msg.toLowerCase();

    if (msg.includes('401') || lo.includes('unauthorized'))
      return 'Authentication failed — the API key is invalid or has been revoked.';
    if ((msg.includes('400') || msg.includes('403')) && (lo.includes('api key') || lo.includes('incorrect key') || lo.includes('invalid key')))
      return `Authentication failed — ${msg.replace(/^\d{3}\s+/, '')}`;
    if (msg.includes('403') || lo.includes('forbidden'))
      return 'Access denied — your API key does not have permission for this operation.';
    if (msg.includes('429') || lo.includes('rate limit') || lo.includes('quota'))
      return 'Rate limit or quota exceeded — your account has reached its usage limit.';
    if (lo.includes('timeout') || lo.includes('abort'))
      return 'Connection timed out — the provider did not respond within the time limit.';
    if (lo.includes('econnrefused') || lo.includes('fetch failed') || lo.includes('network'))
      return 'Network error — could not reach the provider. Check your connection or base URL.';
    if (lo.includes('not configured') || lo.includes('missing'))
      return 'Provider is not configured — please enter an API key.';

    return msg.replace(/^\d{3}\s+/, '').substring(0, 200);
  }

  // ── Encryption ────────────────────────────────────────────────────────────────
  //
  // Delegates to the shared CryptoService. This class previously carried its own
  // AES-256-CBC implementation with a second, differently-valued hardcoded
  // fallback key — meaning values encrypted here could not be decrypted
  // elsewhere. Both the duplicate implementation and the fallback are gone.

  private async encrypt(text: string): Promise<string> {
    return this.crypto.encrypt(text);
  }

  /** Returns '' when a stored key cannot be decrypted, so callers degrade to "not configured". */
  private async decrypt(encoded: string): Promise<string> {
    return this.crypto.decryptIfNeeded(encoded) ?? '';
  }
}
