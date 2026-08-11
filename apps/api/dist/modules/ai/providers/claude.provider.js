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
var ClaudeProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sdk_1 = require("@anthropic-ai/sdk");
let ClaudeProvider = ClaudeProvider_1 = class ClaudeProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(ClaudeProvider_1.name);
        this.providerName = 'claude';
        this.client = null;
        const apiKey = this.configService.get('ai.claude.apiKey');
        this.model = this.configService.get('ai.claude.model', 'claude-haiku-4-5-20251001');
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
            this.logger.log(`Claude provider initialised (model: ${this.model})`);
        }
        else {
            this.unavailableReason = 'CLAUDE_API_KEY is not configured';
        }
    }
    isAvailable() {
        return this.client !== null;
    }
    getStatus() {
        return {
            provider: 'claude',
            model: this.model,
            available: this.isAvailable(),
            reason: this.unavailableReason,
        };
    }
    async complete(request) {
        if (!this.client)
            throw new Error('Claude provider not configured');
        const systemPrompt = request.jsonMode
            ? `${request.systemPrompt ?? ''}\n\nYou MUST respond with valid JSON only. No markdown, no explanation — raw JSON.`.trim()
            : request.systemPrompt;
        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: request.maxTokens ?? 2000,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: [{ role: 'user', content: request.userPrompt }],
            temperature: request.temperature,
        });
        const block = response.content[0];
        return {
            content: block.type === 'text' ? block.text : '',
            tokensUsed: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
        };
    }
};
exports.ClaudeProvider = ClaudeProvider;
exports.ClaudeProvider = ClaudeProvider = ClaudeProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ClaudeProvider);
//# sourceMappingURL=claude.provider.js.map