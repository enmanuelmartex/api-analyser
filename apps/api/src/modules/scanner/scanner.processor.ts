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
import { IssueGuidanceService } from '../ai/guidance/issue-guidance.service';
import {
  emptyFindingCounts,
  foldOccurrenceCounts,
  riskLevelFor,
  type OccurrenceSeverityGroup,
} from '../assessments/assessment-finding-counts';

interface JobData {
  assessmentId: string;
  projectId:    string;
  specId:       string;
  userId?:      string;
  /**
   * Why the run exists, forwarded from whoever queued it. Absent on jobs
   * enqueued before scheduling existed, which are manual by definition.
   */
  trigger?:      'MANUAL' | 'SCHEDULED';
  scheduleId?:   string;
  scheduleName?: string;
}

@Processor('scanner', { concurrency: 3 })
export class ScannerProcessor extends WorkerHost {
  private readonly logger = new Logger(ScannerProcessor.name);

  constructor(
    private prisma:           PrismaService,
    private scannerService:   ScannerService,
    private eventEmitter:     EventEmitter2,
    private pluginRegistry:   PluginRegistryService,
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
    // Provenance travels with the job and is attached to every outcome event,
    // so the audit trail and the notification both name the schedule behind an
    // automatic run instead of implying somebody triggered it by hand.
    const origin = {
      trigger: job.data.trigger ?? ('MANUAL' as const),
      scheduleId: job.data.scheduleId,
      scheduleName: job.data.scheduleName,
    };

    this.logger.log(`Starting assessment ${assessmentId} (user: ${userId ?? 'anonymous'})`);

    try {
      await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: 'RUNNING', startedAt: new Date(), progress: 0, currentStep: 'Initializing' },
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
      await this.updateProgress(assessmentId, 8, 'Parsing');

      await this.addLog(assessmentId, 'info', 'core', `Found ${spec.endpoints.length} endpoints to test`);

      // Announced only once the run is genuinely under way — the plugins are
      // resolved and the specification has been read — so the event carries real
      // scope figures rather than the intent recorded by `scan.queued`.
      this.eventEmitter.emit('scan.started', {
        assessmentId,
        projectId,
        projectName: project.name,
        userId,
        endpointCount: spec.endpoints.length,
        pluginCount: pluginOverride.length,
        ...origin,
      });

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
        // Carried so the per-check events the engine emits are attributed the
        // same way this processor's own events are.
        origin,
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
      const { findings, pluginPlan, aiMeta, cancelled } = await this.scannerService.runAllPlugins(
        context,
        (progress) => {
          this.emit(assessmentId, progress);
          this.updateProgress(assessmentId, progress.progress, progress.step);
        },
        (logEntry) => {
          this.addLog(assessmentId, logEntry.level, logEntry.plugin, logEntry.message);
        },
        userId,
        pluginOverride,
        () => this.isCancelled(assessmentId),
      );

      /*
       * Stop here if the scan was cancelled.
       *
       * Everything below writes the outcome of a completed run — issue
       * reconciliation, the summary, the score, the report — and none of it is
       * true of a run that was stopped a third of the way through. Reconciling
       * partial results would be actively harmful: the checks that never ran
       * would look like checks that found nothing, which is how a still-present
       * vulnerability gets marked resolved.
       *
       * Returns rather than throws, so BullMQ records the job as finished
       * instead of retrying a scan the operator asked to stop.
       */
      if (cancelled) {
        this.logger.log(`Assessment ${assessmentId} stopped: cancelled by the operator`);
        await this.addLog(assessmentId, 'warn', 'core', 'Assessment cancelled before completion');
        this.emit(assessmentId, {
          step: 'Cancelled',
          progress: (await this.currentProgress(assessmentId)) ?? 0,
          message: 'Assessment cancelled',
          findingsCount: findings.length,
          cancelled: true,
        });
        return { assessmentId, cancelled: true };
      }

      this.emit(assessmentId, {
        step: 'Saving Results', stepIndex: 11, totalSteps: 12,
        progress: 92, message: `Saving ${findings.length} findings...`, findingsCount: findings.length,
      });
      await this.updateProgress(assessmentId, 92, 'Saving Results');

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
      //
      // Counted from the PERSISTED occurrences, never from the in-memory
      // `findings` array.
      //
      // Those two numbers are not the same, and treating them as the same is
      // what put a different total on the dashboard than in the report. A raw
      // finding becomes an occurrence only if it has a stable identity, and two
      // raw findings that resolve to the same identity become one — BFLA probes
      // `/admin` and `/admin/`, for instance, and both normalise to `/admin`.
      // Every other surface in the product (the scan list, the findings list,
      // the report body, the score) counts occurrences, so the summary must too.
      const summary = await this.summariseDetections(assessmentId);

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
          totalFindings:   summary.total,
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

      this.emit(assessmentId, {
        step:          'Completed',
        stepIndex:     12,
        totalSteps:    12,
        progress:      100,
        // The recorded total, not the raw detection count: this is the number
        // the user is about to see on the scan they are watching finish.
        message:       `Assessment completed — ${summary.total} issue${summary.total === 1 ? '' : 's'} found in ${duration}s`,
        findingsCount: summary.total,
        completed:     true,
        pluginPlan,
        aiMeta,
      });

      this.logger.log(
        `Assessment ${assessmentId} completed in ${duration}s — ` +
        `${summary.total} findings recorded from ${findings.length} raw detections, ` +
        `${pluginPlan.executed.length} plugins ran, ` +
        `${pluginPlan.skipped.length} skipped, AI: ${aiMeta.available ? aiMeta.provider : 'off'}`,
      );

      /*
       * Announce the outcome on the event bus.
       *
       * Distinct from the `scanner.progress` emit above, which drives one
       * watching browser's progress bar and is meaningless to anyone not
       * currently looking at this scan. This one is the durable fact — the audit
       * writer, the notification dispatcher and the report queue each consume it
       * independently, and this processor knows about none of them.
       *
       * In particular, the automatic PDF is no longer rendered here. It used to
       * be: a fire-and-forget `autoGenerateReport()` call ran Chromium inside
       * the scan worker, holding one of three scan slots for the duration of a
       * render, with no retry, no failure state and no way for the user to learn
       * it had not worked. It is now a job on the `reports` queue, enqueued by
       * ReportsAutoListener in response to this event.
       */
      this.eventEmitter.emit('scan.completed', {
        assessmentId,
        projectId,
        projectName: project.name,
        userId,
        findingsCount: summary.total,
        criticalCount: summary.critical,
        highCount: summary.high,
        mediumCount: summary.medium,
        lowCount: summary.low,
        infoCount: summary.info,
        securityScore: score.securityScore,
        durationMs: Date.now() - startTime,
        ...origin,
      });

      return { assessmentId, findingsCount: summary.total, duration, pluginPlan, aiMeta };
    } catch (error) {
      this.logger.error(`Assessment ${assessmentId} failed: ${error.message}`, error.stack);

      /*
       * A cancelled scan that then throws is still cancelled.
       *
       * Aborting mid-flight can surface an error from work already in progress,
       * and overwriting the status here would tell the operator their scan
       * failed when in fact they stopped it themselves.
       */
      if (await this.isCancelled(assessmentId)) {
        await this.addLog(
          assessmentId,
          'warn',
          'core',
          `Assessment cancelled; the run ended with: ${error.message}`,
        );
        return { assessmentId, cancelled: true };
      }

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

      /*
       * The project is re-read here rather than reused from the try block: the
       * scan can fail before that lookup runs, or fail *because* it returned
       * nothing. Falling back to the id keeps the event emittable either way —
       * a notification that names the wrong project would be worse than one
       * that names an id, but no notification at all is worse than both.
       */
      const failedProject = await this.prisma.project
        .findUnique({ where: { id: projectId }, select: { name: true } })
        .catch(() => null);

      this.eventEmitter.emit('scan.failed', {
        assessmentId,
        projectId,
        projectName: failedProject?.name ?? projectId,
        userId,
        reason: error.message,
        errorCode: error.code,
        stackTrace: error.stack,
        durationMs: Date.now() - startTime,
        ...origin,
      });

      throw error;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private emit(assessmentId: string, data: any) {
    this.eventEmitter.emit('scanner.progress', { assessmentId, ...data });
  }

  /**
   * Persists how far the run has got.
   *
   * `currentStep` is written alongside the percentage, not only at the terminal
   * states. It used to be set exclusively on COMPLETED and FAILED, so a browser
   * that reloaded mid-scan — or one that opened the scan for the first time —
   * got a stale step from before the run started while the bar showed 60%. The
   * progress stream replays this row as its first frame, so the stored value is
   * what a reconnecting client sees before the next live update arrives.
   */
  /**
   * Has the operator cancelled this scan?
   *
   * The cancel endpoint writes CANCELLED and cannot take a running job away
   * from its worker — BullMQ refuses to remove a locked job — so the status
   * column is the signal, read between checks.
   *
   * A failed read answers "no": a transient database blip must not silently
   * abandon a scan that nobody asked to stop.
   */
  private async isCancelled(assessmentId: string): Promise<boolean> {
    try {
      const row = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      return row?.status === 'CANCELLED';
    } catch (error) {
      this.logger.warn(
        `Could not read cancellation state for ${assessmentId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async currentProgress(assessmentId: string): Promise<number | null> {
    const row = await this.prisma.assessment
      .findUnique({ where: { id: assessmentId }, select: { progress: true } })
      .catch(() => null);
    return row?.progress ?? null;
  }

  private async updateProgress(assessmentId: string, progress: number, step?: string) {
    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { progress, ...(step ? { currentStep: step } : {}) },
    });
  }

  private async addLog(assessmentId: string, level: string, plugin: string, message: string) {
    await this.prisma.assessmentLog.create({
      data: { assessmentId, level, plugin, message },
    });
  }

  /**
   * Severity counts, risk level and per-category totals for one scan, read back
   * from the occurrences the lifecycle just wrote.
   *
   * Reading from the database rather than counting the in-memory findings is
   * the whole point: it is the only way the summary can agree with the scan
   * list, the findings list, the report and the score, all of which count
   * occurrences. It also makes the numbers converge on a retry instead of
   * doubling, since the query sees whatever is actually stored.
   *
   * Deliberately does NOT compute a score. It used to carry the original
   * formula (`100 − 20·critical − 10·high − …`), whose result was returned,
   * never read, and silently contradicted `score-v2` — the one scoring
   * implementation, which runs after the assessment reaches COMPLETED.
   */
  private async summariseDetections(assessmentId: string) {
    const [bySeverity, byCategory] = await Promise.all([
      this.prisma.findingOccurrence.groupBy({
        by: ['assessmentId', 'severitySnapshot'],
        where: { assessmentId },
        _count: { _all: true },
      }),
      this.prisma.findingOccurrence.groupBy({
        by: ['owaspSnapshot'],
        where: { assessmentId },
        _count: { _all: true },
      }),
    ]);

    const counts =
      foldOccurrenceCounts(bySeverity as OccurrenceSeverityGroup[]).get(assessmentId) ??
      emptyFindingCounts();

    const owaspCoverage: Record<string, number> = {};
    for (const row of byCategory) {
      if (row.owaspSnapshot) owaspCoverage[row.owaspSnapshot] = row._count._all;
    }

    return { ...counts, riskLevel: riskLevelFor(counts), owaspCoverage };
  }
}
