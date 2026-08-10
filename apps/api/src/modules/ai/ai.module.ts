import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpenAiProvider } from './providers/openai.provider';
import { GrokProvider } from './providers/grok.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { NoopAiProvider } from './providers/noop.provider';
import { AiProviderFactory } from './ai-provider.factory';
import { AiConfigService } from './ai-config.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { GuidanceContextResolver } from './guidance/guidance-context.resolver';
import { SecurityKnowledgeRegistry } from './guidance/security-knowledge.registry';
import { IssueGuidanceService } from './guidance/issue-guidance.service';
import { AiUsageService } from './guidance/ai-usage.service';

@Module({
  imports: [PrismaModule],
  providers: [
    // Concrete providers — used as env-var fallback
    OpenAiProvider,
    GrokProvider,
    ClaudeProvider,
    GeminiProvider,
    OllamaProvider,
    NoopAiProvider,
    // Config resolution (DB → env → defaults) + encryption
    AiConfigService,
    // Factory resolves the active provider at call-time (supports DB override)
    AiProviderFactory,
    // Public service consumed by the scanner
    AiService,
    // Structured security guidance: retrieval, context and persistence
    GuidanceContextResolver,
    SecurityKnowledgeRegistry,
    IssueGuidanceService,
    AiUsageService,
  ],
  controllers: [AiController],
  exports: [AiService, AiConfigService, IssueGuidanceService, SecurityKnowledgeRegistry],
})
export class AiModule {}
