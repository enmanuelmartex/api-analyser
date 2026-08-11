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
var OpenAiProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAiProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_1 = require("openai");
let OpenAiProvider = OpenAiProvider_1 = class OpenAiProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(OpenAiProvider_1.name);
        this.providerName = 'openai';
        this.client = null;
        const apiKey = this.configService.get('ai.openai.apiKey');
        this.model = this.configService.get('ai.openai.model', 'gpt-4o-mini');
        if (apiKey) {
            this.client = new openai_1.default({ apiKey });
            this.logger.log(`OpenAI provider initialised (model: ${this.model})`);
        }
        else {
            this.unavailableReason = 'OPENAI_API_KEY is not configured';
            this.logger.warn('OpenAI provider not configured — OPENAI_API_KEY missing');
        }
    }
    isAvailable() {
        return this.client !== null;
    }
    getStatus() {
        return {
            provider: 'openai',
            model: this.model,
            available: this.isAvailable(),
            reason: this.unavailableReason,
        };
    }
    async complete(request) {
        if (!this.client)
            throw new Error('OpenAI provider not configured');
        const messages = [];
        if (request.systemPrompt) {
            messages.push({ role: 'system', content: request.systemPrompt });
        }
        messages.push({ role: 'user', content: request.userPrompt });
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        });
        return {
            content: response.choices[0]?.message?.content || '',
            tokensUsed: response.usage?.total_tokens,
        };
    }
};
exports.OpenAiProvider = OpenAiProvider;
exports.OpenAiProvider = OpenAiProvider = OpenAiProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OpenAiProvider);
//# sourceMappingURL=openai.provider.js.map