"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopAiProvider = void 0;
const common_1 = require("@nestjs/common");
let NoopAiProvider = class NoopAiProvider {
    constructor() {
        this.providerName = 'none';
        this.model = 'none';
    }
    isAvailable() {
        return false;
    }
    getStatus() {
        return {
            provider: 'none',
            model: 'none',
            available: false,
            reason: 'AI analysis disabled (AI_PROVIDER=none or no API key configured)',
        };
    }
    async complete(_request) {
        throw new Error('AI provider not configured');
    }
};
exports.NoopAiProvider = NoopAiProvider;
exports.NoopAiProvider = NoopAiProvider = __decorate([
    (0, common_1.Injectable)()
], NoopAiProvider);
//# sourceMappingURL=noop.provider.js.map