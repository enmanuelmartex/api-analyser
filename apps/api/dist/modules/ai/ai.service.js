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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const ai_provider_factory_1 = require("./ai-provider.factory");
const ai_config_service_1 = require("./ai-config.service");
const BATCH_SIZE = 5;
let AiService = AiService_1 = class AiService {
    constructor(factory, aiConfigService) {
        this.factory = factory;
        this.aiConfigService = aiConfigService;
        this.logger = new common_1.Logger(AiService_1.name);
    }
    async analyzeFindings(findings, context) {
        const startTime = Date.now();
        const provider = await this.factory.getProvider();
        if (!provider.isAvailable()) {
            const status = provider.getStatus();
            return this.buildMeta({
                provider: status.provider,
                model: status.model,
                available: false,
                analyzed: 0,
                skipped: findings.length,
                startTime,
                tokensUsed: 0,
                status: 'skipped',
                reason: status.reason,
            });
        }
        const config = await this.aiConfigService.getEffectiveConfig();
        const candidates = this.selectCandidates(findings, config);
        let totalTokens = 0;
        let analyzed = 0;
        let anySucceeded = false;
        let anyFailed = false;
        let firstError;
        let providerUnavailable = false;
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
            const batch = candidates.slice(i, i + BATCH_SIZE);
            try {
                const tokens = await this.analyzeBatch(provider, batch, config);
                totalTokens += tokens;
                analyzed += batch.length;
                anySucceeded = true;
            }
            catch (error) {
                firstError = firstError ?? error?.message;
                anyFailed = true;
                providerUnavailable = this.isProviderUnavailable(error);
                this.logger.warn(`AI batch failed (findings ${i}–${i + batch.length}): ${error?.message}`);
                if (providerUnavailable)
                    break;
            }
        }
        if (config.executiveSummary && findings.length > 0 && !providerUnavailable) {
            try {
                const { summary, tokens } = await this.generateExecutiveSummary(provider, findings, context, config);
                totalTokens += tokens;
                findings.forEach((f) => {
                    f.aiAnalysis = f.aiAnalysis ?? {};
                    f.aiAnalysis.executiveSummary = summary;
                });
            }
            catch (error) {
                this.logger.warn(`Executive summary failed: ${error?.message}`);
            }
        }
        const executionStatus = anyFailed && !anySucceeded && candidates.length > 0 ? 'failed' : 'completed';
        return this.buildMeta({
            provider: provider.providerName,
            model: provider.model,
            available: true,
            analyzed,
            skipped: findings.length - analyzed,
            startTime,
            tokensUsed: totalTokens,
            status: executionStatus,
            errorMessage: executionStatus === 'failed' ? firstError : undefined,
        });
    }
    async getProviderStatus() {
        return this.factory.getProviderStatus();
    }
    selectCandidates(findings, config) {
        return findings
            .filter((f) => {
            if (f.severity === 'CRITICAL')
                return config.analyzeCritical;
            if (f.severity === 'HIGH')
                return config.analyzeHigh;
            if (f.severity === 'MEDIUM')
                return config.analyzeMedium;
            if (f.severity === 'LOW')
                return config.analyzeLow;
            return false;
        })
            .slice(0, config.maxFindings);
    }
    isProviderUnavailable(error) {
        const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
        return [401, 403, 429].includes(status) ||
            /\b(401|403|429)\b|quota|billing|unauthori[sz]ed|forbidden/i.test(String(error?.message ?? ''));
    }
    async analyzeBatch(provider, findings, config) {
        const findingsText = findings.map((f, i) => `\nFinding ${i + 1}:\n- Title: ${f.title}\n- Severity: ${f.severity}\n- OWASP: ${f.owaspCategory}\n- URL: ${f.affectedUrl || 'N/A'}\n- Description: ${f.description.substring(0, 400)}`).join('');
        const response = await provider.complete({
            systemPrompt: 'You are a senior API security expert. Return ONLY valid JSON — no markdown, no explanation.',
            userPrompt: `Analyze these ${findings.length} API security finding(s) and return a JSON array with exactly ${findings.length} object(s):

${findingsText}

Each object must have:
{
  "executiveSummary": "2-3 sentence non-technical explanation for management",
  "technicalAnalysis": "Technical root cause (2-3 sentences)",
  "businessImpact": "Business risk and consequences",
  "confidence": "HIGH|MEDIUM|LOW",
  "falsePositiveRisk": "HIGH|MEDIUM|LOW",
  "securityBestPractices": ["3-5 concrete controls aligned with OWASP API Security Top 10"],
  "validationSteps": ["specific steps to verify the remediation without destructive testing"],
  "priorityActions": ["ordered immediate, short-term and preventive actions"],
  "codeExamples": { "vulnerable": "brief vulnerable code", "fixed": "brief secure code" }
}

Requirements: never invent evidence, credentials or compliance claims; distinguish observed facts from recommendations; prefer allowlists, least privilege, server-side authorization, schema validation, rate limiting, secure headers, secret redaction and auditable controls where applicable.`,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            jsonMode: true,
        });
        const parsed = this.parseJsonSafely(response.content);
        const arr = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        findings.forEach((f, i) => {
            if (arr[i])
                f.aiAnalysis = { ...(f.aiAnalysis ?? {}), ...arr[i] };
        });
        return response.tokensUsed ?? 0;
    }
    async generateExecutiveSummary(provider, findings, context, config) {
        const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
        const high = findings.filter((f) => f.severity === 'HIGH').length;
        const medium = findings.filter((f) => f.severity === 'MEDIUM').length;
        const low = findings.filter((f) => f.severity === 'LOW').length;
        const owasp = [...new Set(findings.map((f) => f.owaspCategory))].join(', ');
        const response = await provider.complete({
            systemPrompt: 'You are a CISO-level security expert. Be concise and professional.',
            userPrompt: `Write a 3-4 sentence executive summary of an API security assessment.

Results:
- API: ${context.baseUrl}
- Total: ${findings.length} findings (${critical} Critical, ${high} High, ${medium} Medium, ${low} Low)
- OWASP categories: ${owasp}
- Endpoints tested: ${context.endpoints.length}

Write a professional summary for a CISO. Be direct about risk level and business impact.`,
            maxTokens: Math.min(config.maxTokens, 400),
            temperature: config.temperature,
        });
        return { summary: response.content, tokens: response.tokensUsed ?? 0 };
    }
    parseJsonSafely(content) {
        if (!content)
            return null;
        try {
            return JSON.parse(content);
        }
        catch { }
        const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch) {
            try {
                return JSON.parse(fenceMatch[1]);
            }
            catch { }
        }
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]);
            }
            catch { }
        }
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                return JSON.parse(objectMatch[0]);
            }
            catch { }
        }
        this.logger.warn('Could not parse AI response as JSON');
        return null;
    }
    buildMeta(params) {
        return {
            provider: params.provider,
            model: params.model,
            available: params.available,
            analyzed: params.analyzed,
            skipped: params.skipped,
            durationMs: Date.now() - params.startTime,
            tokensUsed: params.tokensUsed,
            status: params.status,
            reason: params.reason,
            errorMessage: params.errorMessage,
        };
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ai_provider_factory_1.AiProviderFactory,
        ai_config_service_1.AiConfigService])
], AiService);
//# sourceMappingURL=ai.service.js.map