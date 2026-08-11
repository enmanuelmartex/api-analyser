"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AiConfigService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiConfigService = exports.PROVIDER_DEFAULTS = exports.ALL_PROVIDERS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_service_1 = require("../../common/crypto/crypto.service");
const prisma_service_1 = require("../../prisma/prisma.service");
const openai_provider_1 = require("./providers/openai.provider");
const grok_provider_1 = require("./providers/grok.provider");
const claude_provider_1 = require("./providers/claude.provider");
const gemini_provider_1 = require("./providers/gemini.provider");
const ollama_provider_1 = require("./providers/ollama.provider");
exports.ALL_PROVIDERS = ['openai', 'grok', 'claude', 'gemini', 'ollama'];
const PROFILE_PRESETS = {
    minimal: { analyzeCritical: true, analyzeHigh: false, analyzeMedium: false, analyzeLow: false, executiveSummary: true },
    balanced: { analyzeCritical: true, analyzeHigh: true, analyzeMedium: false, analyzeLow: false, executiveSummary: true },
    complete: { analyzeCritical: true, analyzeHigh: true, analyzeMedium: true, analyzeLow: true, executiveSummary: true },
};
exports.PROVIDER_DEFAULTS = {
    openai: { model: 'gpt-4o-mini', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
    grok: { model: 'llama-3.3-70b-versatile', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
    claude: { model: 'claude-haiku-4-5-20251001', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
    gemini: { model: 'gemini-2.5-flash', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
    ollama: { model: 'llama3.2:3b', maxTokens: 1000, temperature: 0.2, timeoutMs: 60000, maxFindings: 5 },
};
let AiConfigService = AiConfigService_1 = class AiConfigService {
    constructor(prisma, configService, crypto) {
        this.prisma = prisma;
        this.configService = configService;
        this.crypto = crypto;
        this.logger = new common_1.Logger(AiConfigService_1.name);
    }
    async getAllConfigs() {
        const rows = await this.prisma.aiProviderConfig.findMany();
        const rowMap = new Map(rows.map((r) => [r.provider, r]));
        return Promise.all(exports.ALL_PROVIDERS.map((p) => this.buildResponseDto(p, rowMap.get(p) ?? null)));
    }
    async getProviderConfig(provider) {
        const row = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
        return this.buildResponseDto(provider, row);
    }
    async saveProviderConfig(provider, dto) {
        const existing = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
        const defaults = exports.PROVIDER_DEFAULTS[provider] ?? {};
        const profile = dto.profile ?? existing?.profile ?? 'balanced';
        const preset = PROFILE_PRESETS[profile];
        const analyzeCritical = profile === 'custom' ? (dto.analyzeCritical ?? existing?.analyzeCritical ?? true) : (preset?.analyzeCritical ?? true);
        const analyzeHigh = profile === 'custom' ? (dto.analyzeHigh ?? existing?.analyzeHigh ?? true) : (preset?.analyzeHigh ?? true);
        const analyzeMedium = profile === 'custom' ? (dto.analyzeMedium ?? existing?.analyzeMedium ?? false) : (preset?.analyzeMedium ?? false);
        const analyzeLow = profile === 'custom' ? (dto.analyzeLow ?? existing?.analyzeLow ?? false) : (preset?.analyzeLow ?? false);
        const executiveSummary = profile === 'custom' ? (dto.executiveSummary ?? existing?.executiveSummary ?? true) : (preset?.executiveSummary ?? true);
        let encryptedKey = existing?.apiKey ?? null;
        if (dto.apiKey && dto.apiKey.trim()) {
            encryptedKey = await this.encrypt(dto.apiKey.trim());
        }
        const data = {
            model: dto.model ?? existing?.model ?? defaults.model ?? null,
            apiKey: encryptedKey,
            baseUrl: dto.baseUrl !== undefined ? (dto.baseUrl || null) : (existing?.baseUrl ?? null),
            profile,
            analyzeCritical,
            analyzeHigh,
            analyzeMedium,
            analyzeLow,
            executiveSummary,
            maxTokens: dto.maxTokens ?? existing?.maxTokens ?? null,
            temperature: dto.temperature ?? existing?.temperature ?? null,
            timeoutMs: dto.timeoutMs ?? existing?.timeoutMs ?? null,
            maxFindings: dto.maxFindings ?? existing?.maxFindings ?? null,
            retryAttempts: dto.retryAttempts ?? existing?.retryAttempts ?? 2,
        };
        await this.prisma.aiProviderConfig.upsert({
            where: { provider },
            create: { provider, isActive: false, ...data },
            update: data,
        });
        this.logger.log(`Saved config for provider=${provider}, profile=${profile}`);
        return this.getProviderConfig(provider);
    }
    async activateProvider(provider) {
        await this.prisma.$transaction([
            this.prisma.aiProviderConfig.updateMany({ where: { isActive: true }, data: { isActive: false } }),
            this.prisma.aiProviderConfig.upsert({
                where: { provider },
                create: { provider, isActive: true },
                update: { isActive: true },
            }),
        ]);
        this.logger.log(`Activated AI provider: ${provider}`);
        return this.getProviderConfig(provider);
    }
    async deactivateAll() {
        await this.prisma.aiProviderConfig.updateMany({ where: { isActive: true }, data: { isActive: false } });
        this.logger.log('All AI providers deactivated');
    }
    async testProvider(provider, dto) {
        const existing = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
        const defaults = exports.PROVIDER_DEFAULTS[provider] ?? {};
        const start = Date.now();
        let apiKey = dto.apiKey?.trim();
        if (!apiKey && existing?.apiKey) {
            apiKey = await this.decrypt(existing.apiKey);
        }
        if (!apiKey) {
            apiKey = this.configService.get(`ai.${provider}.apiKey`);
        }
        const model = dto.model ?? existing?.model ?? defaults.model;
        const baseUrl = dto.baseUrl ?? existing?.baseUrl ?? undefined;
        let result;
        try {
            const testProvider = this.buildTransientProvider(provider, apiKey, model, baseUrl);
            if (!testProvider.isAvailable()) {
                result = {
                    success: false,
                    message: testProvider.getStatus().reason || 'Provider not available. Check the API key.',
                };
            }
            else {
                await testProvider.complete({
                    userPrompt: 'Reply with exactly: {"ok":true}',
                    systemPrompt: 'You are a test responder. Return ONLY valid JSON.',
                    maxTokens: 50,
                    temperature: 0,
                    jsonMode: true,
                });
                const latencyMs = Date.now() - start;
                result = { success: true, message: `Connected to ${provider} in ${latencyMs}ms.`, latencyMs, model };
            }
        }
        catch (error) {
            result = { success: false, message: this.describeError(error), latencyMs: Date.now() - start };
        }
        await this.prisma.aiProviderConfig.upsert({
            where: { provider },
            create: { provider, isActive: false, lastTestedAt: new Date(), lastTestSuccess: result.success, lastTestMessage: result.message },
            update: { lastTestedAt: new Date(), lastTestSuccess: result.success, lastTestMessage: result.message },
        });
        return result;
    }
    async deleteProviderConfig(provider) {
        await this.prisma.aiProviderConfig.deleteMany({ where: { provider } });
        this.logger.log(`Removed DB config for provider=${provider}`);
    }
    async getEffectiveConfig() {
        const active = await this.prisma.aiProviderConfig.findFirst({ where: { isActive: true } });
        if (active) {
            const apiKey = active.apiKey ? await this.decrypt(active.apiKey) : undefined;
            const defaults = exports.PROVIDER_DEFAULTS[active.provider] ?? {};
            return {
                provider: active.provider,
                model: active.model ?? defaults.model ?? 'gpt-4o-mini',
                apiKey,
                baseUrl: active.baseUrl ?? undefined,
                maxTokens: active.maxTokens ?? defaults.maxTokens ?? 2000,
                temperature: active.temperature ?? defaults.temperature ?? 0.2,
                timeoutMs: active.timeoutMs ?? defaults.timeoutMs ?? 30000,
                maxFindings: active.maxFindings ?? defaults.maxFindings ?? 10,
                retryAttempts: active.retryAttempts ?? 2,
                executiveSummary: active.executiveSummary,
                analyzeCritical: active.analyzeCritical,
                analyzeHigh: active.analyzeHigh,
                analyzeMedium: active.analyzeMedium,
                analyzeLow: active.analyzeLow,
                configSource: 'database',
            };
        }
        return this.resolveFromEnv();
    }
    getEnvStatus() {
        return {
            openai: { apiKey: Boolean(this.configService.get('ai.openai.apiKey')), model: this.configService.get('ai.openai.model', 'gpt-4o-mini') },
            grok: { apiKey: Boolean(this.configService.get('ai.grok.apiKey')), model: this.configService.get('ai.grok.model', 'llama-3.3-70b-versatile') },
            claude: { apiKey: Boolean(this.configService.get('ai.claude.apiKey')), model: this.configService.get('ai.claude.model', 'claude-haiku-4-5-20251001') },
            gemini: { apiKey: Boolean(this.configService.get('ai.gemini.apiKey')), model: this.configService.get('ai.gemini.model', 'gemini-2.5-flash') },
            ollama: { baseUrl: this.configService.get('ai.ollama.baseUrl', 'http://localhost:11434'), model: this.configService.get('ai.ollama.model', 'llama3') },
            activeProvider: this.configService.get('ai.provider', 'none'),
        };
    }
    buildShimConfigService(provider, apiKey, model, baseUrl, timeoutMs) {
        const values = {
            [`ai.${provider}.apiKey`]: apiKey ?? '',
            [`ai.${provider}.model`]: model ?? exports.PROVIDER_DEFAULTS[provider]?.model ?? 'gpt-4o-mini',
            [`ai.${provider}.timeoutMs`]: timeoutMs ?? exports.PROVIDER_DEFAULTS[provider]?.timeoutMs ?? 30000,
            'ai.ollama.baseUrl': baseUrl ?? this.configService.get('ai.ollama.baseUrl', 'http://localhost:11434'),
            'ai.ollama.model': model ?? exports.PROVIDER_DEFAULTS['ollama']?.model ?? 'llama3',
        };
        return {
            get: (key, defaultVal) => (key in values ? values[key] : defaultVal),
        };
    }
    async buildResponseDto(provider, row) {
        const defaults = exports.PROVIDER_DEFAULTS[provider] ?? {};
        const envApiKey = this.configService.get(`ai.${provider}.apiKey`);
        const envModel = provider === 'ollama'
            ? this.configService.get('ai.ollama.baseUrl', 'http://localhost:11434')
            : this.configService.get(`ai.${provider}.model`, defaults.model);
        const configSource = row ? 'database'
            : (envApiKey || provider === 'ollama') ? 'environment'
                : 'defaults';
        const hasKey = Boolean(row?.apiKey) || Boolean(envApiKey) || provider === 'ollama';
        let maskedKey;
        if (row?.apiKey) {
            maskedKey = this.maskKey(await this.decrypt(row.apiKey));
        }
        else if (envApiKey) {
            maskedKey = this.maskKey(envApiKey);
        }
        return {
            provider,
            model: row?.model ?? defaults.model ?? 'gpt-4o-mini',
            maskedKey,
            hasKey,
            baseUrl: row?.baseUrl ?? undefined,
            isActive: row?.isActive ?? false,
            profile: row?.profile ?? 'balanced',
            analyzeCritical: row?.analyzeCritical ?? true,
            analyzeHigh: row?.analyzeHigh ?? true,
            analyzeMedium: row?.analyzeMedium ?? false,
            analyzeLow: row?.analyzeLow ?? false,
            executiveSummary: row?.executiveSummary ?? true,
            maxTokens: row?.maxTokens ?? defaults.maxTokens ?? 2000,
            temperature: row?.temperature ?? defaults.temperature ?? 0.2,
            timeoutMs: row?.timeoutMs ?? defaults.timeoutMs ?? 30000,
            maxFindings: row?.maxFindings ?? defaults.maxFindings ?? 10,
            retryAttempts: row?.retryAttempts ?? 2,
            configSource,
            lastTestedAt: row?.lastTestedAt?.toISOString(),
            lastTestSuccess: row?.lastTestSuccess ?? undefined,
            lastTestMessage: row?.lastTestMessage ?? undefined,
            configuredAt: row?.configuredAt?.toISOString(),
            envHasKey: Boolean(envApiKey) || provider === 'ollama',
            envModel,
        };
    }
    resolveFromEnv() {
        const providerName = this.configService.get('ai.provider', 'none').toLowerCase();
        const cfg = this.configService.get(`ai.${providerName}`) ?? {};
        const defaults = exports.PROVIDER_DEFAULTS[providerName] ?? {};
        return {
            provider: providerName,
            model: cfg.model ?? defaults.model ?? 'gpt-4o-mini',
            apiKey: cfg.apiKey || undefined,
            baseUrl: cfg.baseUrl || undefined,
            maxTokens: cfg.maxTokens ?? defaults.maxTokens ?? 2000,
            temperature: cfg.temperature ?? defaults.temperature ?? 0.2,
            timeoutMs: cfg.timeoutMs ?? defaults.timeoutMs ?? 30000,
            maxFindings: cfg.maxFindings ?? defaults.maxFindings ?? 10,
            retryAttempts: 2,
            executiveSummary: cfg.executiveSummary ?? true,
            analyzeCritical: cfg.analyzeCritical ?? true,
            analyzeHigh: cfg.analyzeHigh ?? true,
            analyzeMedium: cfg.analyzeMedium ?? false,
            analyzeLow: cfg.analyzeLow ?? false,
            configSource: providerName !== 'none' && (cfg.apiKey || providerName === 'ollama')
                ? 'environment'
                : 'defaults',
        };
    }
    buildTransientProvider(provider, apiKey, model, baseUrl) {
        const shim = this.buildShimConfigService(provider, apiKey, model, baseUrl);
        switch (provider) {
            case 'openai': return new openai_provider_1.OpenAiProvider(shim);
            case 'grok': return new grok_provider_1.GrokProvider(shim);
            case 'claude': return new claude_provider_1.ClaudeProvider(shim);
            case 'gemini': return new gemini_provider_1.GeminiProvider(shim);
            case 'ollama': return new ollama_provider_1.OllamaProvider(shim);
            default: throw new Error(`Unknown AI provider: "${provider}"`);
        }
    }
    maskKey(key) {
        if (!key || key.length < 8)
            return '••••••••••••';
        const prefix = key.startsWith('sk-') ? 'sk-' : key.slice(0, 2);
        const suffix = key.slice(-4);
        return `${prefix}${'•'.repeat(12)}${suffix}`;
    }
    describeError(error) {
        const raw = error?.message || String(error);
        const msg = raw.replace(/^(\d{3})\s+"(.+)"$/, '$1 $2');
        const lo = msg.toLowerCase();
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
    async encrypt(text) {
        return this.crypto.encrypt(text);
    }
    async decrypt(encoded) {
        return this.crypto.decryptIfNeeded(encoded) ?? '';
    }
};
exports.AiConfigService = AiConfigService;
exports.AiConfigService = AiConfigService = AiConfigService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        crypto_service_1.CryptoService])
], AiConfigService);
//# sourceMappingURL=ai-config.service.js.map