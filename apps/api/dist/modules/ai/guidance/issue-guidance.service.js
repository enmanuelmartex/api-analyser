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
var IssueGuidanceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueGuidanceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const ai_provider_factory_1 = require("../ai-provider.factory");
const ai_config_service_1 = require("../ai-config.service");
const guidance_context_resolver_1 = require("./guidance-context.resolver");
const security_knowledge_registry_1 = require("./security-knowledge.registry");
const guidance_prompt_builder_1 = require("./guidance-prompt.builder");
const security_guidance_schema_1 = require("./security-guidance.schema");
const provider_pricing_1 = require("./provider-pricing");
const MAX_ISSUES_PER_SCAN = 25;
const RETRYABLE_ATTEMPTS = 2;
let IssueGuidanceService = IssueGuidanceService_1 = class IssueGuidanceService {
    constructor(prisma, factory, aiConfigService, contextResolver, knowledge) {
        this.prisma = prisma;
        this.factory = factory;
        this.aiConfigService = aiConfigService;
        this.contextResolver = contextResolver;
        this.knowledge = knowledge;
        this.logger = new common_1.Logger(IssueGuidanceService_1.name);
    }
    async enrichIssues(input) {
        const provider = await this.factory.getProvider();
        const base = {
            requested: input.issueIds.length,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            tokensInput: 0,
            tokensOutput: 0,
            estimatedCostUsd: 0,
            provider: provider.providerName,
            model: provider.model,
        };
        if (!provider.isAvailable() || input.issueIds.length === 0) {
            return { ...base, skipped: input.issueIds.length };
        }
        const config = await this.aiConfigService.getEffectiveConfig().catch(() => ({}));
        const issues = await this.prisma.securityIssue.findMany({
            where: { id: { in: input.issueIds } },
            orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
            take: MAX_ISSUES_PER_SCAN,
            select: {
                id: true,
                title: true,
                description: true,
                severity: true,
                owaspCategory: true,
                ruleId: true,
                method: true,
                normalizedRoute: true,
                component: true,
                occurrences: {
                    orderBy: { detectedAt: 'desc' },
                    take: 1,
                    select: { httpRequest: true, httpResponse: true },
                },
            },
        });
        base.skipped = input.issueIds.length - issues.length;
        for (const issue of issues) {
            try {
                const outcome = await this.enrichOne(issue, provider, config, input.authType);
                base.tokensInput += outcome.tokensInput;
                base.tokensOutput += outcome.tokensOutput;
                base.estimatedCostUsd += outcome.costUsd;
                if (outcome.ok)
                    base.succeeded += 1;
                else
                    base.failed += 1;
                if (outcome.fatal) {
                    base.skipped += issues.length - (base.succeeded + base.failed);
                    break;
                }
            }
            catch (error) {
                base.failed += 1;
                this.logger.warn(`Guidance failed for issue ${issue.id}: ${error?.message}`);
            }
        }
        base.estimatedCostUsd = Number(base.estimatedCostUsd.toFixed(6));
        return base;
    }
    async enrichOne(issue, provider, config, authType) {
        const evidence = issue.occurrences?.[0];
        const context = this.contextResolver.resolve({
            httpResponse: evidence?.httpResponse,
            authType,
        });
        const selection = this.knowledge.select({
            owaspCategory: issue.owaspCategory,
            ruleId: issue.ruleId,
            technologies: context.technologies.map((t) => t.name),
        });
        const userPrompt = (0, guidance_prompt_builder_1.buildGuidanceUserPrompt)({
            title: issue.title,
            severity: issue.severity,
            owaspCategory: issue.owaspCategory,
            ruleId: issue.ruleId,
            method: issue.method,
            route: issue.normalizedRoute,
            component: issue.component,
            description: issue.description ?? '',
            httpRequest: evidence?.httpRequest,
            httpResponse: evidence?.httpResponse,
            context,
            playbooks: selection.playbooks,
        });
        let lastError = null;
        let tokensInput = 0;
        let tokensOutput = 0;
        for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
            try {
                const response = await provider.complete({
                    systemPrompt: (0, guidance_prompt_builder_1.buildGuidanceSystemPrompt)(),
                    userPrompt,
                    maxTokens: config?.maxTokens ?? 1600,
                    temperature: config?.temperature ?? 0.2,
                    jsonMode: true,
                });
                const split = (0, provider_pricing_1.splitTokens)(response.tokensUsed ?? 0);
                tokensInput = split.tokensInput;
                tokensOutput = split.tokensOutput;
                const parsed = (0, security_guidance_schema_1.parseSecurityGuidance)(response.content, {
                    allowedTechnologies: context.allowed,
                });
                const outcome = parsed;
                if (!outcome.ok || !outcome.guidance) {
                    lastError = {
                        code: outcome.errorCode ?? 'NOT_JSON',
                        message: outcome.message ?? 'The provider response could not be validated.',
                    };
                    if (attempt < RETRYABLE_ATTEMPTS)
                        continue;
                    break;
                }
                const guidance = outcome.guidance;
                if (outcome.droppedFields?.length) {
                    this.logger.debug(`Dropped unverifiable guidance fields for ${issue.id}: ${outcome.droppedFields.join(', ')}`);
                }
                const costUsd = (0, provider_pricing_1.estimateCostUsd)(provider.providerName, provider.model, tokensInput, tokensOutput);
                await this.store(issue.id, {
                    status: 'READY',
                    payload: guidance,
                    confidence: guidance.confidence,
                    errorCode: null,
                    provider: provider.providerName,
                    model: provider.model,
                    playbookIds: selection.playbooks.map((p) => p.id),
                    knowledgeVersion: selection.version,
                    tokensInput,
                    tokensOutput,
                    costUsd,
                });
                return { ok: true, fatal: false, tokensInput, tokensOutput, costUsd };
            }
            catch (error) {
                const fatal = this.isProviderUnavailable(error);
                lastError = {
                    code: fatal ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
                    message: error?.message ?? 'Unknown provider error',
                };
                if (fatal)
                    break;
                if (attempt < RETRYABLE_ATTEMPTS) {
                    await delay(500 * attempt);
                    continue;
                }
            }
        }
        const costUsd = (0, provider_pricing_1.estimateCostUsd)(provider.providerName, provider.model, tokensInput, tokensOutput);
        await this.store(issue.id, {
            status: 'FAILED',
            payload: null,
            confidence: null,
            errorCode: lastError?.code ?? 'UNKNOWN',
            provider: provider.providerName,
            model: provider.model,
            playbookIds: selection.playbooks.map((p) => p.id),
            knowledgeVersion: selection.version,
            tokensInput,
            tokensOutput,
            costUsd,
        });
        this.logger.warn(`Guidance unavailable for issue ${issue.id}: ${lastError?.code} — ${lastError?.message}`);
        return {
            ok: false,
            fatal: lastError?.code === 'PROVIDER_UNAVAILABLE',
            tokensInput,
            tokensOutput,
            costUsd,
        };
    }
    async store(issueId, data) {
        const row = {
            status: data.status,
            payload: (data.payload ?? undefined),
            errorCode: data.errorCode,
            schemaVersion: security_guidance_schema_1.GUIDANCE_SCHEMA_VERSION,
            promptVersion: guidance_prompt_builder_1.GUIDANCE_PROMPT_VERSION,
            knowledgeVersion: data.knowledgeVersion,
            playbookIds: data.playbookIds,
            provider: data.provider,
            model: data.model,
            confidence: data.confidence,
            tokensInput: data.tokensInput,
            tokensOutput: data.tokensOutput,
            costUsd: data.costUsd,
            generatedAt: new Date(),
        };
        try {
            await this.prisma.issueGuidance.upsert({
                where: { issueId },
                create: { issueId, ...row },
                update: row,
            });
        }
        catch (error) {
            this.logger.error(`Could not store guidance for issue ${issueId}: ${error?.message}`);
        }
    }
    isProviderUnavailable(error) {
        const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
        return ([401, 403, 429].includes(status) ||
            /\b(401|403|429)\b|quota|billing|rate.?limit|unauthori[sz]ed|forbidden/i.test(String(error?.message ?? '')));
    }
};
exports.IssueGuidanceService = IssueGuidanceService;
exports.IssueGuidanceService = IssueGuidanceService = IssueGuidanceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ai_provider_factory_1.AiProviderFactory,
        ai_config_service_1.AiConfigService,
        guidance_context_resolver_1.GuidanceContextResolver,
        security_knowledge_registry_1.SecurityKnowledgeRegistry])
], IssueGuidanceService);
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=issue-guidance.service.js.map