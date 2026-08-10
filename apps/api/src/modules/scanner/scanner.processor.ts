import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ScannerService } from './scanner.service';
import { ScanContext, BasePlugin } from './types/scanner.types';
import { resolveTargetUrl } from '../../common/utils/url-resolver.util';
import { createHash } from 'crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { decryptAuthFields } from '../../common/crypto/auth-config.crypto';
import { IssueLifecycleService } from '../issues/issue-lifecycle.service';
import { ScoringService } from '../scoring/scoring.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { ReportsService } from '../reports/reports.service';
import { IssueGuidanceService } from '../ai/guidance/issue-guidance.service';

interface JobData {
  assessmentId: string;
  projectId:    string;
  specId:       string;
  userId?:      string;
}

@Processor('scanner', { concurrency: 3 })
export class ScannerProcessor extends WorkerHost {
  private readonly logger = new Logger(ScannerProcessor.name);

  constructor(
    private prisma:           PrismaService,
    private scannerService:   ScannerService,
    private eventEmitter:     EventEmitter2,
    private pluginRegistry:   PluginRegistryService,
    private reportsService:   ReportsService,
    private crypto:           CryptoService,
    private issueLifecycle:   IssueLifecycleService,
    private scoring:          ScoringService,
    private issueGuidance:    IssueGuidanceService,
  ) {
    super();
  }

  /**
   * Stable hash of the effective scan configuration, stored on each occurrence
   * so a detection can be tied to the exact settings that produced it.
   * Deterministic: keys are sorted, so a retry produces the same hash.
   */
  private hashConfig(config: any): string | undefined {
    if (!config) return undefined;
    const relevant = {
      executionMode: config.executionMode,
      resolvedPlugins: [...(config.resolvedPlugins ?? [])].sort(),
      maxRequestsPerEndpoint: config.maxRequestsPerEndpoint,
      requestDelayMs: config.requestDelayMs,
      timeoutMs: config.timeoutMs,
      enableAiAnalysis: config.enableAiAnalysis,
    };
    return createHash('sha256').update(JSON.stringify(relevant), 'utf8').digest('hex');
  }

  async process(job: Job<JobData>) {
    const { assessmentId, projectId, specId, userId } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting assessment ${assessmentId} (user: ${userId ?? 'anonymous'})`);

    try {
      await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: 'RUNNING', startedAt: new Date(), progress: 0 },
      });

      this.emit(assessmentId, {
        step: 'Initializing', stepIndex: 0, totalSteps: 12,
        progress: 2, message: 'Initializing assessment engine...', findingsCount: 0,
      });

      const [spec, project] = await Promise.all([
        this.prisma.apiSpec.findUnique({
          where: { id: specId },
          include: { authConfig: true, endpoints: true },
        }),
        this.prisma.project.findUnique({ where: { id: projectId } }),
      ]);

      if (!spec)    throw new Error('API specification not found');
      if (!project) throw new Error('Project not found');

      // Cast to any: Bun's internal package cache serves stale Prisma types at
      // TS compile time; the DB schema and runtime behaviour are correct.
      const assessmentConfig: any = await this.prisma.assessmentConfig.findUnique({
        where: { assessmentId },
      });

      // The API resolves and freezes the effective selection before queueing.
      // Never fall back to all plugins when an explicit selection is empty/invalid.
      let resolvedPluginIds: string[] = assessmentConfig?.resolvedPlugins ?? [];

      // Backward compatibility for jobs created before resolvedPlugins existed.
      if (!resolvedPluginIds.length && assessmentConfig?.executionMode === 'profile' && assessmentConfig.scanProfileId) {
        const legacyProfile = await this.prisma.scanProfile.findUnique({ where: { id: assessmentConfig.scanProfileId } });
        resolvedPluginIds = legacyProfile?.enabledPlugins ?? [];
      } else if (!resolvedPluginIds.length && assessmentConfig?.executionMode === 'manual') {
        resolvedPluginIds = assessmentConfig.manualPlugins ?? [];
      } else if (!resolvedPluginIds.length && (!assessmentConfig?.executionMode || assessmentConfig.executionMode === 'all')) {
        resolvedPluginIds = userId
          ? (await this.pluginRegistry.getEnabledForUser(userId)).map((plugin) => plugin.manifest.id)
          : (await this.pluginRegistry.getEnabledGlobally()).map((plugin) => plugin.manifest.id);
      }

      if (!resolvedPluginIds.length) throw new Error('Assessment has no resolved plugins');
      const pluginOverride: BasePlugin[] = this.pluginRegistry.getByIds(resolvedPluginIds);
      if (pluginOverride.length !== resolvedPluginIds.length) {
        throw new Error('One or more assessment plugins are no longer available');
      }

      this.emit(assessmentId, {
        step: 'Parsing', stepIndex: 1, totalSteps: 12,
        progress: 8, message: `Discovered ${spec.endpoints.length} endpoints`, findingsCount: 0,
      });

      await this.addLog(assessmentId, 'info', 'core', `Found ${spec.endpoints.length} endpoints to test`);

      const authConfig = decryptAuthFields(this.crypto, spec.authConfig as any);

      const context: ScanContext = {
        assessmentId,
        projectId,
        baseUrl: resolveTargetUrl(project.baseUrl ?? ''),
        // Credentials are encrypted at rest; decrypt at the point of use only.
        // The plaintext lives in this in-memory context and is never persisted
        // or logged — BasePlugin redacts it out of all evidence.
        auth: {
          type:           (authConfig?.type as any) || 'NONE',
          token:          authConfig?.token        ?? undefined,
          username:       authConfig?.username     ?? undefined,
          password:       authConfig?.password     ?? undefined,
          apiKey:         authConfig?.apiKey       ?? undefined,
          apiKeyHeader:   authConfig?.apiKeyHeader ?? undefined,
          apiKeyLocation: (authConfig?.apiKeyLocation as any) ?? 'header',
          customHeaders:  (authConfig?.customHeaders as any)  ?? undefined,
        },
        endpoints: spec.endpoints.map((e) => ({
          id:          e.id,
          path:        e.path,
          method:      e.method,
          summary:     e.summary     ?? undefined,
          tags:        e.tags,
          parameters:  (e.parameters as any) ?? [],
          requestBody: e.requestBody  ?? undefined,
          responses:   e.responses   ?? undefined,
          security:    (e.security as any) ?? [],
          deprecated:  e.deprecated,
        })),
        config: {
          executionMode:          (assessmentConfig?.executionMode as any) ?? 'all',
          enableAiAnalysis:       assessmentConfig?.enableAiAnalysis       ?? true,
          maxRequestsPerEndpoint: assessmentConfig?.maxRequestsPerEndpoint ?? 10,
          requestDelayMs:         assessmentConfig?.requestDelayMs         ?? 200,
          timeoutMs:              assessmentConfig?.timeoutMs              ?? 10000,
        },
      };

      // Upsert, not create. `assessmentId` is unique, so on a BullMQ retry a
      // bare create raises a unique-constraint violation that replaces the
      // ORIGINAL failure in the logs — the real cause of the first failure was
      // being masked by a symptom of the retry.
      await this.prisma.assessmentSummary.upsert({
        where: { assessmentId },
        update: { totalEndpoints: spec.endpoints.length },
        create: { assessmentId, totalEndpoints: spec.endpoints.length, testedEndpoints: 0 },
      });

      // ── Execute all enabled plugins + AI analysis ─────────────────────────
      const { findings, pluginPlan, aiMeta } = await this.scannerService.runAllPlugins(
        context,
        (progress) => {
          this.emit(assessmentId, progress);
          this.updateProgress(assessmentId, progress.progress);
        },
        (logEntry) => {
          this.addLog(assessmentId, logEntry.level, logEntry.plugin, logEntry.message);
        },
        userId,
        pluginOverride,
      );

      this.emit(assessmentId, {
        step: 'Saving Results', stepIndex: 11, totalSteps: 12,
        progress: 92, message: `Saving ${findings.length} findings...`, findingsCount: findings.length,
      });

      // ── Persist detections as issues + occurrences ────────────────────────
      //
      // Replaces the previous `Promise.all(findings.map(create))`, which had no
      // identity, no deduplication and no idempotency: a retry inserted every
      // finding a second time, and a rescan created a fresh OPEN row for a
      // vulnerability that had already been triaged.
      const detectedAt = new Date();
      const lifecycle = await this.issueLifecycle.persistScanResults({
        projectId,
        assessmentId,
        findings,
        detectedAt,
        assessmentConfigHash: this.hashConfig(assessmentConfig),
        specVersion: spec.version ?? undefined,
        scope: {
          // Only checks that ran to completion may resolve an issue.
          successfulPlugins: pluginPlan.executed.filter((id) => !pluginPlan.failed.includes(id)),
          failedPlugins: pluginPlan.failed,
          skippedPlugins: pluginPlan.skipped,
          pluginVersions: pluginPlan.versions,
        },
      });

      await this.addLog(
        assessmentId,
        'info',
        'core',
        `Persisted ${lifecycle.occurrencesCreated} detections — ` +
          `${lifecycle.issuesCreated} new, ${lifecycle.issuesRecurring} recurring, ` +
          `${lifecycle.issuesReopened} reopened, ${lifecycle.issuesResolved} resolved, ` +
          `${lifecycle.issuesNotTested} not tested` +
          (lifecycle.occurrencesSkipped > 0
            ? ` (${lifecycle.occurrencesSkipped} already recorded by a previous attempt)`
            : ''),
      );

      /*
       * AI security guidance — after persistence, never before.
       *
       * Guidance is keyed by issue id, which does not exist until the lifecycle
       * has written the issues. Running here also means enrichment sees the
       * deduplicated vulnerabilities rather than raw findings, so a rule that
       * matched forty endpoints costs one call instead of forty.
       *
       * Wrapped in its own try/catch and awaited: a provider outage, a rate
       * limit or a malformed answer must never change the outcome of the scan.
       * Failures are recorded per issue as a FAILED guidance row.
       */
      let guidanceMeta: any = null;
      if (assessmentConfig?.enableAiAnalysis !== false) {
        try {
          const scannedIssues = await this.prisma.securityIssue.findMany({
            where: { projectId, occurrences: { some: { assessmentId } } },
            select: { id: true },
          });

          guidanceMeta = await this.issueGuidance.enrichIssues({
            issueIds: scannedIssues.map((issue) => issue.id),
            projectId,
            authType: authConfig?.type ?? null,
          });

          await this.addLog(
            assessmentId,
            guidanceMeta.failed > 0 ? 'warn' : 'info',
            'ai',
            `AI guidance: ${guidanceMeta.succeeded} generated, ${guidanceMeta.failed} failed, ` +
              `${guidanceMeta.skipped} skipped (${guidanceMeta.provider}/${guidanceMeta.model}, ` +
              `~$${guidanceMeta.estimatedCostUsd.toFixed(4)} estimated)`,
          );
        } catch (error: any) {
          this.logger.warn(`AI guidance step failed entirely: ${error?.message}`);
          await this.addLog(
            assessmentId,
            'warn',
            'ai',
            `AI guidance unavailable: ${error?.message}. Scanner evidence is unaffected.`,
          );
        }
      }

      // ── Compute and persist summary ───────────────────────────────────────
      const summary = this.calculateSummary(findings, spec.endpoints.length);

      // Execution scope. Coverage answers "how much did we look at?" and is
      // deliberately kept separate from the score, which answers "how bad is
      // what we found?".
      const plannedChecks    = pluginPlan.executed.length;
      const failedChecks     = pluginPlan.failed.length;
      const successfulChecks = plannedChecks - failedChecks;
      const skippedChecks    = pluginPlan.skipped.length;

      // Counts and execution scope only. The score itself is computed by
      // ScoringService below, from the persisted occurrences — there is exactly
      // one scoring implementation and the processor is not it.
      await this.prisma.assessmentSummary.update({
        where: { assessmentId },
        data: {
          testedEndpoints: spec.endpoints.length,
          totalFindings:   findings.length,
          criticalCount:   summary.critical,
          highCount:       summary.high,
          mediumCount:     summary.medium,
          lowCount:        summary.low,
          infoCount:       summary.info,
          plannedChecks,
          successfulChecks,
          failedChecks,
          skippedChecks,
          executionErrors: failedChecks,
          riskLevel:       summary.riskLevel,
          owaspCoverage:   summary.owaspCoverage,
          pluginResults:   pluginPlan as any,
          aiStatus:        aiMeta as any,
        },
      });

      const duration = Math.round((Date.now() - startTime) / 1000);

      await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: {
          status:      'COMPLETED',
          completedAt: new Date(),
          progress:    100,
          duration,
          currentStep: 'Completed',
        },
      });

      // Scored after the status is COMPLETED, because the engine refuses to
      // score a non-terminal assessment. Derived entirely from persisted data,
      // so a retry recomputes the same snapshot rather than drifting.
      const score = await this.scoring.scoreAssessment(assessmentId);
      await this.addLog(
        assessmentId,
        'info',
        'core',
        score.securityScore === null
          ? `Score unavailable: ${score.reasons.join(' ')}`
          : `Score ${score.securityScore}/100 (${score.scoreStatus}, ${score.scoreVersion}) — ` +
            `coverage ${score.coveragePercent ?? 'unknown'}%`,
      );

      // PDF is the canonical automatic artifact; other formats remain on-demand exports.
      this.autoGenerateReport(assessmentId, userId).catch((err) =>
        this.logger.warn(`Auto-report generation failed for ${assessmentId}: ${err.message}`),
      );

      this.emit(assessmentId, {
        step:          'Completed',
        stepIndex:     12,
        totalSteps:    12,
        progress:      100,
        message:       `Assessment completed — ${findings.length} issues found in ${duration}s`,
        findingsCount: findings.length,
        completed:     true,
        pluginPlan,
        aiMeta,
      });

      this.logger.log(
        `Assessment ${assessmentId} completed in ${duration}s — ` +
        `${findings.length} findings, ${pluginPlan.executed.length} plugins ran, ` +
        `${pluginPlan.skipped.length} skipped, AI: ${aiMeta.available ? aiMeta.provider : 'off'}`,
      );

      return { assessmentId, findingsCount: findings.length, duration, pluginPlan, aiMeta };
    } catch (error) {
      this.logger.error(`Assessment ${assessmentId} failed: ${error.message}`, error.stack);

      await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: 'FAILED', completedAt: new Date(), currentStep: `Failed: ${error.message}` },
      });

      // A failed run must never leave a score behind. The schema default is
      // already UNAVAILABLE with a null score, but the summary may have been
      // partially updated before the failure, so clear it explicitly.
      await this.prisma.assessmentSummary
        .update({
          where: { assessmentId },
          data: {
            securityScore: null,
            scoreStatus: 'UNAVAILABLE',
            scoreVersion: null,
            scoreComputedAt: null,
          },
        })
        .catch(() => {
          // No summary row yet — the scan failed before one was created.
        });

      await this.addLog(assessmentId, 'error', 'core', error.message);

      this.emit(assessmentId, {
        step:         'Failed',
        progress:     0,
        message:      `Assessment failed: ${error.message}`,
        findingsCount: 0,
        error:        error.message,
      });

      throw error;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private emit(assessmentId: string, data: any) {
    this.eventEmitter.emit('scanner.progress', { assessmentId, ...data });
  }

  private async updateProgress(assessmentId: string, progress: number) {
    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { progress },
    });
  }

  private async addLog(assessmentId: string, level: string, plugin: string, message: string) {
    await this.prisma.assessmentLog.create({
      data: { assessmentId, level, plugin, message },
    });
  }

  /**
   * Issues the canonical PDF for a finished scan.
   *
   * Delegates to the same idempotent generation path the API exposes, so the
   * automatic report and a user-triggered one converge on a single artifact
   * instead of racing to insert two rows for the same scan. Previously this
   * rendered a PDF, threw the bytes away and recorded only their length — the
   * row that produced looked like a report but had nothing to download.
   */
  private async autoGenerateReport(assessmentId: string, userId?: string) {
    const owner =
      userId ??
      (
        await this.prisma.assessment.findUnique({
          where: { id: assessmentId },
          select: { project: { select: { userId: true } } },
        })
      )?.project?.userId;

    if (!owner) {
      this.logger.warn(`Skipping auto-report for ${assessmentId}: no owning user could be resolved.`);
      return;
    }

    await this.reportsService.generate(assessmentId, owner, {
      type: 'TECHNICAL',
      format: 'PDF',
    });
  }

  /**
   * Severity counts, risk level and per-category finding totals.
   *
   * Deliberately does NOT compute a score. It used to carry the original
   * formula (`100 − 20·critical − 10·high − …`), whose result was returned,
   * never read, and silently contradicted `score-v2` — the one scoring
   * implementation, which runs after the assessment reaches COMPLETED and
   * works from persisted occurrences rather than this in-memory list.
   */
  private calculateSummary(findings: any[], _totalEndpoints: number) {
    const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
    const high     = findings.filter((f) => f.severity === 'HIGH').length;
    const medium   = findings.filter((f) => f.severity === 'MEDIUM').length;
    const low      = findings.filter((f) => f.severity === 'LOW').length;
    const info     = findings.filter((f) => f.severity === 'INFO').length;

    let riskLevel = 'LOW';
    if (critical > 0)               riskLevel = 'CRITICAL';
    else if (high > 2)              riskLevel = 'HIGH';
    else if (high > 0 || medium > 3) riskLevel = 'HIGH';
    else if (medium > 0 || low > 5) riskLevel = 'MEDIUM';

    const owaspCoverage: Record<string, number> = {};
    for (const f of findings) {
      owaspCoverage[f.owaspCategory] = (owaspCoverage[f.owaspCategory] || 0) + 1;
    }

    return { critical, high, medium, low, info, riskLevel, owaspCoverage };
  }
}
