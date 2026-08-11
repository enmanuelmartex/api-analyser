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
var AiProviderFactory_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProviderFactory = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ai_config_service_1 = require("./ai-config.service");
const openai_provider_1 = require("./providers/openai.provider");
const grok_provider_1 = require("./providers/grok.provider");
const claude_provider_1 = require("./providers/claude.provider");
const gemini_provider_1 = require("./providers/gemini.provider");
const ollama_provider_1 = require("./providers/ollama.provider");
const noop_provider_1 = require("./providers/noop.provider");
let AiProviderFactory = AiProviderFactory_1 = class AiProviderFactory {
    constructor(configService, aiConfigService, openAi, grok, claude, gemini, ollama, noop) {
        this.configService = configService;
        this.aiConfigService = aiConfigService;
        this.openAi = openAi;
        this.grok = grok;
        this.claude = claude;
        this.gemini = gemini;
        this.ollama = ollama;
        this.noop = noop;
        this.logger = new common_1.Logger(AiProviderFactory_1.name);
    }
    async getProvider() {
        try {
            const config = await this.aiConfigService.getEffectiveConfig();
            if (!config || config.provider === 'none')
                return this.noop;
            const shim = this.aiConfigService.buildShimConfigService(config.provider, config.apiKey, config.model, config.baseUrl, config.timeoutMs);
            let provider;
            switch (config.provider) {
                case 'openai':
                    provider = new openai_provider_1.OpenAiProvider(shim);
                    break;
                case 'grok':
                    provider = new grok_provider_1.GrokProvider(shim);
                    break;
                case 'claude':
                    provider = new claude_provider_1.ClaudeProvider(shim);
                    break;
                case 'gemini':
                    provider = new gemini_provider_1.GeminiProvider(shim);
                    break;
                case 'ollama':
                    provider = new ollama_provider_1.OllamaProvider(shim);
                    break;
                default:
                    this.logger.warn(`Unknown AI provider "${config.provider}" — falling back to noop`);
                    return this.noop;
            }
            if (!provider.isAvailable()) {
                this.logger.warn(`Provider "${config.provider}" unavailable (${provider.getStatus().reason}) — AI analysis will be skipped`);
                return this.noop;
            }
            return provider;
        }
        catch (error) {
            this.logger.warn(`Failed to resolve provider from config service (${error?.message}) — falling back to env vars`);
            return this.getEnvProvider();
        }
    }
    async getProviderStatus() {
        try {
            const config = await this.aiConfigService.getEffectiveConfig();
            const hasCredential = Boolean(config.apiKey) || config.provider === 'ollama';
            return {
                provider: config.provider,
                model: config.model,
                available: config.provider !== 'none' && hasCredential,
                reason: config.provider === 'none'
                    ? 'AI analysis is disabled'
                    : !hasCredential
                        ? `No API key configured for ${config.provider}`
                        : undefined,
            };
        }
        catch {
            return this.getEnvProvider().getStatus();
        }
    }
    getEnvProvider() {
        const name = this.configService.get('ai.provider', 'openai').toLowerCase();
        const map = {
            openai: this.openAi,
            grok: this.grok,
            claude: this.claude,
            gemini: this.gemini,
            ollama: this.ollama,
            none: this.noop,
        };
        const provider = map[name] ?? this.noop;
        if (!provider.isAvailable() && provider !== this.noop) {
            this.logger.warn(`Env-var provider "${name}" has no API key — using noop`);
            return this.noop;
        }
        return provider;
    }
};
exports.AiProviderFactory = AiProviderFactory;
exports.AiProviderFactory = AiProviderFactory = AiProviderFactory_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        ai_config_service_1.AiConfigService,
        openai_provider_1.OpenAiProvider,
        grok_provider_1.GrokProvider,
        claude_provider_1.ClaudeProvider,
        gemini_provider_1.GeminiProvider,
        ollama_provider_1.OllamaProvider,
        noop_provider_1.NoopAiProvider])
], AiProviderFactory);
//# sourceMappingURL=ai-provider.factory.js.map