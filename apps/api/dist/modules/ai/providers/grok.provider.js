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
var GrokProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrokProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_1 = require("openai");
let GrokProvider = GrokProvider_1 = class GrokProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(GrokProvider_1.name);
        this.providerName = 'grok';
        this.client = null;
        const apiKey = this.configService.get('ai.grok.apiKey');
        this.model = this.configService.get('ai.grok.model', 'llama-3.3-70b-versatile');
        if (apiKey) {
            this.client = new openai_1.default({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
            this.logger.log(`Groq provider initialised (model: ${this.model})`);
        }
        else {
            this.unavailableReason = 'GROQ_API_KEY is not configured';
        }
    }
    isAvailable() {
        return this.client !== null;
    }
    getStatus() {
        return {
            provider: 'grok',
            model: this.model,
            available: this.isAvailable(),
            reason: this.unavailableReason,
        };
    }
    async complete(request) {
        if (!this.client)
            throw new Error('Groq provider not configured');
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
exports.GrokProvider = GrokProvider;
exports.GrokProvider = GrokProvider = GrokProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GrokProvider);
//# sourceMappingURL=grok.provider.js.map