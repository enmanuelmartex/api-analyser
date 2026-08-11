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
var OllamaProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let OllamaProvider = OllamaProvider_1 = class OllamaProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(OllamaProvider_1.name);
        this.providerName = 'ollama';
        this.baseUrl = this.configService.get('ai.ollama.baseUrl', 'http://localhost:11434');
        this.model = this.configService.get('ai.ollama.model', 'llama3');
        this.timeoutMs = this.configService.get('ai.ollama.timeoutMs', 60000);
        this.logger.log(`Ollama provider initialised (baseUrl: ${this.baseUrl}, model: ${this.model})`);
    }
    isAvailable() {
        return Boolean(this.baseUrl);
    }
    getStatus() {
        return {
            provider: 'ollama',
            model: this.model,
            available: this.isAvailable(),
            reason: this.isAvailable() ? undefined : 'OLLAMA_BASE_URL not configured',
        };
    }
    async complete(request) {
        const prompt = request.systemPrompt
            ? `${request.systemPrompt}\n\n${request.userPrompt}`
            : request.userPrompt;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt,
                    stream: false,
                    options: {
                        temperature: request.temperature,
                        num_predict: request.maxTokens,
                    },
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`Ollama API error ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            return { content: data.response || '' };
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.OllamaProvider = OllamaProvider;
exports.OllamaProvider = OllamaProvider = OllamaProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OllamaProvider);
//# sourceMappingURL=ollama.provider.js.map