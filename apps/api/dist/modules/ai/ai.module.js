"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const openai_provider_1 = require("./providers/openai.provider");
const grok_provider_1 = require("./providers/grok.provider");
const claude_provider_1 = require("./providers/claude.provider");
const gemini_provider_1 = require("./providers/gemini.provider");
const ollama_provider_1 = require("./providers/ollama.provider");
const noop_provider_1 = require("./providers/noop.provider");
const ai_provider_factory_1 = require("./ai-provider.factory");
const ai_config_service_1 = require("./ai-config.service");
const ai_service_1 = require("./ai.service");
const ai_controller_1 = require("./ai.controller");
const guidance_context_resolver_1 = require("./guidance/guidance-context.resolver");
const security_knowledge_registry_1 = require("./guidance/security-knowledge.registry");
const issue_guidance_service_1 = require("./guidance/issue-guidance.service");
const ai_usage_service_1 = require("./guidance/ai-usage.service");
let AiModule = class AiModule {
};
exports.AiModule = AiModule;
exports.AiModule = AiModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        providers: [
            openai_provider_1.OpenAiProvider,
            grok_provider_1.GrokProvider,
            claude_provider_1.ClaudeProvider,
            gemini_provider_1.GeminiProvider,
            ollama_provider_1.OllamaProvider,
            noop_provider_1.NoopAiProvider,
            ai_config_service_1.AiConfigService,
            ai_provider_factory_1.AiProviderFactory,
            ai_service_1.AiService,
            guidance_context_resolver_1.GuidanceContextResolver,
            security_knowledge_registry_1.SecurityKnowledgeRegistry,
            issue_guidance_service_1.IssueGuidanceService,
            ai_usage_service_1.AiUsageService,
        ],
        controllers: [ai_controller_1.AiController],
        exports: [ai_service_1.AiService, ai_config_service_1.AiConfigService, issue_guidance_service_1.IssueGuidanceService, security_knowledge_registry_1.SecurityKnowledgeRegistry],
    })
], AiModule);
//# sourceMappingURL=ai.module.js.map