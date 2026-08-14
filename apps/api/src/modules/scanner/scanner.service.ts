import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ScanContext, ScanFinding, BasePlugin } from './types/scanner.types';
import { AiService } from '../ai/ai.service';
import type { AiAnalysisMeta } from '../ai/interfaces/ai-provider.interface';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { PluginExecutorService } from '../plugins/plugin-executor.service';

type ProgressCallback = (progress: any) => void;
type LogCallback      = (entry: { level: string; plugin: string; message: string }) => void;

// ── Result contract ────────────────────────────────────────────────────────────

export interface PluginExecutionPlan {
  /** All plugin IDs present in the registry */
  available:      string[];
  /** Plugin IDs that were selected and attempted this assessment */
  executed:       string[];
  /**
   * Plugin IDs that were attempted but did NOT complete successfully.
   *
   * Load-bearing for issue reconciliation: only a check that ran to completion
   * may resolve an issue. A failed or timed-out check produces "not tested",
   * never "fixed", so this must never be conflated with `executed`.
   */
  failed:         string[];
  /** Plugin IDs that were skipped (not selected, or disabled) */
  skipped:        string[];
  /** Why each skipped plugin was skipped */
  skippedReason:  Record<string, string>;
  /** Plugin version strings */
  versions:       Record<string, string>;
  /** Wall-clock execution time per plugin (ms) */
  durationMs:     Record<string, number>;
  /** Findings count per plugin */
  findingCounts:  Record<string, number>;
}

export interface ScanRunResult {
  findings:      ScanFinding[];
  pluginPlan:    PluginExecutionPlan;
  aiMeta:        AiAnalysisMeta;
  /** True when the run stopped early because the scan was cancelled. */
  cancelled:     boolean;
}

/**
 * Asked between checks: should this run stop?
 *
 * A check in flight is never interrupted — a plugin holds open HTTP connections
 * to the target and killing it mid-request would leave the evidence it has
 * gathered in an unknown state. Cancellation therefore takes effect at the next
 * boundary, which on a real scan is seconds away.
 */
type AbortCheck = () => Promise<boolean>;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly aiService:        AiService,
    private readonly pluginRegistry:   PluginRegistryService,
    private readonly pluginExecutor:   PluginExecutorService,
    private readonly eventEmitter:     EventEmitter2,
  ) {}

  async runAllPlugins(
    context:        ScanContext,
    onProgress:     ProgressCallback,
    onLog:          LogCallback,
    userId?:        string,
    pluginOverride?: BasePlugin[],
    shouldAbort?:   AbortCheck,
  ): Promise<ScanRunResult> {
    const allFindings: ScanFinding[] = [];
    let cancelled = false;

    // ── 1. Resolve which plugins should run ───────────────────────────────────
    //
    //  pluginOverride supplied  → use exactly those plugins (profile / manual mode)
    //  With user context        → respect per-user enable/disable (PluginUserConfig)
    //                             falling back to global Plugin.isEnabled
    //  Without user context     → use global Plugin.isEnabled only
    //
    const enabledPlugins: BasePlugin[] = pluginOverride !== undefined
      ? pluginOverride
      : userId
        ? await this.pluginRegistry.getEnabledForUser(userId)
        : await this.pluginRegistry.getEnabledGlobally();

    const allRegistered = this.pluginRegistry.getAll();

    // Build the execution plan (tracks available / executed / skipped)
    const enabledIds = new Set(enabledPlugins.map((p) => p.manifest.id));
    const plan: PluginExecutionPlan = {
      available:     allRegistered.map((p) => p.manifest.id),
      executed:      [],
      failed:        [],
      skipped:       [],
      skippedReason: {},
      versions:      Object.fromEntries(allRegistered.map((p) => [p.manifest.id, p.manifest.version])),
      durationMs:    {},
      findingCounts: {},
    };

    for (const p of allRegistered) {
      if (!enabledIds.has(p.manifest.id)) {
        plan.skipped.push(p.manifest.id);
        plan.skippedReason[p.manifest.id] = userId ? 'disabled_by_user' : 'disabled_globally';
      }
    }

    // ── 2. Log the execution plan ─────────────────────────────────────────────
    onLog({
      level: 'info',
      plugin: 'core',
      message: `Plugin execution plan: ${enabledPlugins.length} enabled, ${plan.skipped.length} skipped`,
    });

    if (plan.skipped.length > 0) {
      onLog({
        level: 'info',
        plugin: 'core',
        message: `Skipped plugins: ${plan.skipped.join(', ')}`,
      });
    }

    const totalSteps = enabledPlugins.length + 2; // +2 for init + AI
    let stepIndex = 2;

    // ── 3. Execute each enabled plugin ────────────────────────────────────────
    for (const plugin of enabledPlugins) {
      const pluginId   = plugin.manifest.id;
      const pluginName = plugin.manifest.name;
      const progress   = Math.round((stepIndex / totalSteps) * 82) + 8;

      // Checked before starting a check, never during one.
      if (await shouldAbort?.()) {
        cancelled = true;
        // Recorded as skipped rather than silently dropped: reconciliation must
        // not read "the check did not run" as "the vulnerability is gone".
        for (const remaining of enabledPlugins.slice(enabledPlugins.indexOf(plugin))) {
          plan.skipped.push(remaining.manifest.id);
          plan.skippedReason[remaining.manifest.id] = 'cancelled';
        }
        onLog({
          level: 'warn',
          plugin: 'core',
          message: `Assessment cancelled — ${plan.skipped.length} check(s) did not run`,
        });
        break;
      }

      const pluginConfig = userId
        ? await this.pluginRegistry.getPluginConfig(pluginId, userId)
        : (plugin.manifest.defaultConfig ?? {});

      onProgress({
        step:          pluginName,
        stepIndex,
        totalSteps,
        progress,
        message:       `Running ${pluginName}...`,
        findingsCount: allFindings.length,
        currentPlugin: pluginId,
        assessmentId:  context.assessmentId,
      });

      onLog({ level: 'info', plugin: pluginId, message: `Starting ${pluginName}` });

      const { findings, durationMs, status } = await this.pluginExecutor.executeInPipeline(
        plugin,
        context,
        userId ?? 'system',
        pluginConfig,
      );

      allFindings.push(...findings);
      plan.executed.push(pluginId);
      if (status !== 'SUCCESS') {
        // Recorded separately so reconciliation cannot treat "the check broke"
        // as "the vulnerability is gone".
        plan.failed.push(pluginId);
        plan.skippedReason[pluginId] = `execution_${status.toLowerCase()}`;
      }
      plan.durationMs[pluginId]    = durationMs;
      plan.findingCounts[pluginId] = findings.length;

      const logLevel = status === 'SUCCESS' ? 'info' : (status === 'TIMEOUT' ? 'warn' : 'error');
      onLog({
        level:   logLevel,
        plugin:  pluginId,
        message: status === 'SUCCESS'
          ? `${pluginName} completed — ${findings.length} finding(s) in ${durationMs}ms`
          : `${pluginName} ${status.toLowerCase()} after ${durationMs}ms`,
      });

      /*
       * The same fact on the application-wide bus.
       *
       * `onLog` writes to `assessment_logs`, which is scoped to one scan and only
       * readable by someone already looking at it. An operator watching the live
       * tail has no way to reach that table, so a check timing out — the thing
       * that quietly narrows coverage — was invisible outside the scan page.
       */
      this.eventEmitter.emit('scan.check.finished', {
        assessmentId: context.assessmentId,
        projectId:    context.projectId,
        userId,
        pluginId,
        pluginName,
        status,
        findingsCount: findings.length,
        durationMs,
        // Provenance, so an automatic run's per-check events are attributed to
        // the scheduler rather than to the owner whose account it runs under.
        ...(context.origin ?? {}),
      });

      stepIndex++;
    }

    // ── 4. AI analysis (post-processor — NEVER blocks assessment completion) ──
    let aiMeta: AiAnalysisMeta = {
      provider:  'none',
      model:     'none',
      available: false,
      status:    'skipped',
      analyzed:  0,
      skipped:   allFindings.length,
      durationMs: 0,
      tokensUsed: 0,
      reason:    'AI analysis disabled for this assessment',
    };

    // Cancelled runs skip enrichment: it costs provider tokens to annotate
    // findings from a scan that is being thrown away.
    if (context.config.enableAiAnalysis && !cancelled) {
      onProgress({
        step:          'AI Analysis',
        stepIndex:     totalSteps - 1,
        totalSteps,
        progress:      92,
        message:       `AI analysis on ${allFindings.length} findings...`,
        findingsCount: allFindings.length,
        currentPlugin: 'ai-analysis',
        assessmentId:  context.assessmentId,
      });

      onLog({ level: 'info', plugin: 'ai-analysis', message: 'Starting AI-powered analysis' });

      aiMeta = await this.aiService.analyzeFindings(allFindings, context);

      if (aiMeta.available) {
        onLog({
          level:   'info',
          plugin:  'ai-analysis',
          message: `AI analysis complete — ${aiMeta.analyzed} findings enriched by ${aiMeta.provider} in ${aiMeta.durationMs}ms`,
        });
      } else {
        onLog({
          level:   'warn',
          plugin:  'ai-analysis',
          message: `AI analysis skipped: ${aiMeta.reason ?? 'provider unavailable'}`,
        });
      }
    }

    return { findings: allFindings, pluginPlan: plan, aiMeta, cancelled };
  }
}
