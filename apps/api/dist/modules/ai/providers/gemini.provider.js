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
var GeminiProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const genai_1 = require("@google/genai");
let GeminiProvider = GeminiProvider_1 = class GeminiProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(GeminiProvider_1.name);
        this.providerName = 'gemini';
        this.client = null;
        const apiKey = this.configService.get('ai.gemini.apiKey');
        this.model = this.configService.get('ai.gemini.model', 'gemini-2.5-flash');
        if (apiKey) {
            this.client = new genai_1.GoogleGenAI({ apiKey });
            this.logger.log(`Gemini provider initialised (model: ${this.model})`);
        }
        else {
            this.unavailableReason = 'GEMINI_API_KEY is not configured';
        }
    }
    isAvailable() {
        return this.client !== null;
    }
    getStatus() {
        return {
            provider: 'gemini',
            model: this.model,
            available: this.isAvailable(),
            reason: this.unavailableReason,
        };
    }
    async complete(request) {
        if (!this.client)
            throw new Error('Gemini provider not configured');
        const result = await this.client.models.generateContent({
            model: this.model,
            contents: request.userPrompt,
            config: {
                ...(request.systemPrompt ? { systemInstruction: request.systemPrompt } : {}),
                maxOutputTokens: request.maxTokens ?? 2000,
                temperature: request.temperature,
                ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
            },
        });
        return {
            content: result.text ?? '',
            tokensUsed: result.usageMetadata?.totalTokenCount,
        };
    }
};
exports.GeminiProvider = GeminiProvider;
exports.GeminiProvider = GeminiProvider = GeminiProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GeminiProvider);
//# sourceMappingURL=gemini.provider.js.map