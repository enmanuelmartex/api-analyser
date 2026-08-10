import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiProviderFactory } from '../ai-provider.factory';
import { AiConfigService } from '../ai-config.service';
import type { IAiProvider } from '../interfaces/ai-provider.interface';
import { GuidanceContextResolver } from './guidance-context.resolver';
import { SecurityKnowledgeRegistry } from './security-knowledge.registry';
import {
  GUIDANCE_PROMPT_VERSION,
  buildGuidanceSystemPrompt,
  buildGuidanceUserPrompt,
} from './guidance-prompt.builder';
import {
  GUIDANCE_SCHEMA_VERSION,
  parseSecurityGuidance,
} from './security-guidance.schema';
import { estimateCostUsd, splitTokens } from './provider-pricing';

/**
 * Produces and stores AI guidance for persisted issues.
 *
 * Runs AFTER `IssueLifecycleService.persistScanResults`, deliberately: guidance
 * is keyed by `issueId`, which does not exist until the issue has been
 * persisted. This also means enrichment operates on the deduplicated set of
 * vulnerabilities rather than on raw findings, so a rule matching forty
 * endpoints costs one call, not forty.
 *
 * The hard constraint, restated in code: **this must never fail a scan.**
 * Every path returns rather than throws, and a failure is recorded as a row
 * with status FAILED so the UI can say "we tried and could not" instead of
 * silently showing nothing.
 */

export interface EnrichIssuesInput {
  issueIds: string[];
  projectId: string;
  /** Auth type configured for the target, used for context resolution. */
  authType?: string | null;
}

export interface EnrichIssuesResult {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
  provider: string;
  model: string;
}

/** Bounded so one scan cannot spend unboundedly on a large finding set. */
const MAX_ISSUES_PER_SCAN = 25;
const RETRYABLE_ATTEMPTS = 2;

@Injectable()
export class IssueGuidanceService {
  private readonly logger = new Logger(IssueGuidanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: AiProviderFactory,
    private readonly aiConfigService: AiConfigService,
    private readonly contextResolver: GuidanceContextResolver,
    private readonly knowledge: SecurityKnowledgeRegistry,
  ) {}

  async enrichIssues(input: EnrichIssuesInput): Promise<EnrichIssuesResult> {
    const provider = await this.factory.getProvider();
    const base: EnrichIssuesResult = {
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

    const config = await this.aiConfigService.getEffectiveConfig().catch(() => ({}) as any);

    // Highest severity first: if the budget runs out, it runs out on the
    // findings that matter least.
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
        if (outcome.ok) base.succeeded += 1;
        else base.failed += 1;

        // A provider that is rate-limited or out of credit will reject every
        // remaining call too; stopping saves the wait and the noise.
        if (outcome.fatal) {
          base.skipped += issues.length - (base.succeeded + base.failed);
          break;
        }
      } catch (error: any) {
        // Defence in depth. `enrichOne` is written not to throw; if it ever
        // does, the scan still completes.
        base.failed += 1;
        this.logger.warn(`Guidance failed for issue ${issue.id}: ${error?.message}`);
      }
    }

    base.estimatedCostUsd = Number(base.estimatedCostUsd.toFixed(6));
    return base;
  }

  private async enrichOne(
    issue: any,
    provider: IAiProvider,
    config: any,
    authType?: string | null,
  ): Promise<{ ok: boolean; fatal: boolean; tokensInput: number; tokensOutput: number; costUsd: number }> {
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

    const userPrompt = buildGuidanceUserPrompt({
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

    let lastError: { code: string; message: string } | null = null;
    let tokensInput = 0;
    let tokensOutput = 0;

    for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
      try {
        const response = await provider.complete({
          systemPrompt: buildGuidanceSystemPrompt(),
          userPrompt,
          maxTokens: config?.maxTokens ?? 1600,
          temperature: config?.temperature ?? 0.2,
          jsonMode: true,
        });

        const split = splitTokens(response.tokensUsed ?? 0);
        tokensInput = split.tokensInput;
        tokensOutput = split.tokensOutput;

        const parsed = parseSecurityGuidance(response.content, {
          allowedTechnologies: context.allowed,
        });

        // Read through an explicit shape rather than relying on discriminated
        // union narrowing: this project compiles with `strictNullChecks: false`,
        // under which narrowing on a boolean literal does not apply.
        const outcome = parsed as {
          ok: boolean;
          guidance?: import('./security-guidance.schema').SecurityGuidance;
          droppedFields?: string[];
          errorCode?: string;
          message?: string;
        };

        if (!outcome.ok || !outcome.guidance) {
          lastError = {
            code: outcome.errorCode ?? 'NOT_JSON',
            message: outcome.message ?? 'The provider response could not be validated.',
          };
          // A malformed answer is worth exactly one retry: the same prompt at a
          // nonzero temperature can produce valid JSON on a second pass.
          if (attempt < RETRYABLE_ATTEMPTS) continue;
          break;
        }

        const guidance = outcome.guidance;

        if (outcome.droppedFields?.length) {
          this.logger.debug(
            `Dropped unverifiable guidance fields for ${issue.id}: ${outcome.droppedFields.join(', ')}`,
          );
        }

        const costUsd = estimateCostUsd(
          provider.providerName,
          provider.model,
          tokensInput,
          tokensOutput,
        );

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
      } catch (error: any) {
        const fatal = this.isProviderUnavailable(error);
        lastError = {
          code: fatal ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
          message: error?.message ?? 'Unknown provider error',
        };
        if (fatal) break;
        if (attempt < RETRYABLE_ATTEMPTS) {
          await delay(500 * attempt);
          continue;
        }
      }
    }

    const costUsd = estimateCostUsd(
      provider.providerName,
      provider.model,
      tokensInput,
      tokensOutput,
    );

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

    this.logger.warn(
      `Guidance unavailable for issue ${issue.id}: ${lastError?.code} — ${lastError?.message}`,
    );

    return {
      ok: false,
      fatal: lastError?.code === 'PROVIDER_UNAVAILABLE',
      tokensInput,
      tokensOutput,
      costUsd,
    };
  }

  /**
   * Writes the current guidance for an issue.
   *
   * Upsert on the unique `issueId`: a rescan replaces the previous answer
   * rather than accumulating rows. History is not kept because guidance is
   * advice about the current state, not a record of what was observed — the
   * immutable record is the occurrence, which is untouched by any of this.
   *
   * A storage failure is logged and swallowed: losing guidance is acceptable,
   * failing the scan that produced the findings is not.
   */
  private async store(
    issueId: string,
    data: {
      status: 'READY' | 'FAILED' | 'SKIPPED';
      payload: unknown;
      confidence: number | null;
      errorCode: string | null;
      provider: string;
      model: string;
      playbookIds: string[];
      knowledgeVersion: string;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
    },
  ): Promise<void> {
    const row = {
      status: data.status as any,
      payload: (data.payload ?? undefined) as any,
      errorCode: data.errorCode,
      schemaVersion: GUIDANCE_SCHEMA_VERSION,
      promptVersion: GUIDANCE_PROMPT_VERSION,
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
      await (this.prisma as any).issueGuidance.upsert({
        where: { issueId },
        create: { issueId, ...row },
        update: row,
      });
    } catch (error: any) {
      this.logger.error(`Could not store guidance for issue ${issueId}: ${error?.message}`);
    }
  }

  /** Rate limit, auth and quota failures — retrying these only wastes time. */
  private isProviderUnavailable(error: any): boolean {
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
    return (
      [401, 403, 429].includes(status) ||
      /\b(401|403|429)\b|quota|billing|rate.?limit|unauthori[sz]ed|forbidden/i.test(
        String(error?.message ?? ''),
      )
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
