import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
import { ScanContext } from '../scanner/types/scanner.types';

export interface SinglePluginRunOptions {
  pluginId: string;
  projectId: string;
  userId: string;
  assessmentId?: string;
  pluginConfig?: Record<string, any>;
  timeoutMs?: number;
}

export interface SinglePluginRunResult {
  pluginId: string;
  pluginName: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  findingsCount: number;
  durationMs: number;
  findings: any[];
  error?: string;
  executionId: string;
}

@Injectable()
export class PluginExecutorService {
  private readonly logger = new Logger(PluginExecutorService.name);
  private readonly DEFAULT_TIMEOUT_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
  ) {}

  /**
   * Safely execute a single plugin with timeout enforcement and full metrics capture.
   * One broken plugin will NEVER propagate an exception.
   */
  async runSinglePlugin(options: SinglePluginRunOptions): Promise<SinglePluginRunResult> {
    const { pluginId, userId, projectId, assessmentId, pluginConfig, timeoutMs } = options;

    const plugin = this.registry.getById(pluginId);
    if (!plugin) {
      return {
        pluginId,
        pluginName: pluginId,
        status: 'FAILED',
        findingsCount: 0,
        durationMs: 0,
        findings: [],
        error: `Plugin "${pluginId}" not found in registry`,
        executionId: '',
      };
    }

    /*
     * Ownership must be proven before anything below touches this project —
     * `buildContext` reads the project's stored `authConfig` (bearer token,
     * basic auth password, API key) and hands it straight to the plugin,
     * which then sends live traffic to `project.baseUrl` carrying it. The
     * result is returned to the caller as-is, including raw HTTP
     * request/response evidence, without the redaction the normal scan
     * pipeline applies through `IssueLifecycleService`. Without this check,
     * any authenticated user could run a plugin against any other user's
     * project by guessing or enumerating its id, using that project's own
     * credentials, and read back the unredacted result — a cross-tenant scan
     * plus a credential/evidence leak in one request. Rejected outright with
     * `ForbiddenException` rather than folded into the FAILED-status path
     * below: a caller who is not this project's owner gets no confirmation
     * the project exists, and no scan traffic is ever sent on their behalf.
     */
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        apiSpec: {
          include: { authConfig: true, endpoints: true },
        },
      },
    });
    if (!project) {
      throw new ForbiddenException('Project not found or access denied');
    }

    const execution = await this.prisma.pluginExecution.create({
      data: {
        pluginId,
        assessmentId: assessmentId ?? null,
        userId,
        status: 'SUCCESS',
        startedAt: new Date(),
      },
    });

    const startedAt = Date.now();
    const deadline = timeoutMs ?? this.DEFAULT_TIMEOUT_MS;

    let status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' = 'SUCCESS';
    let errorMessage: string | undefined;
    let findings: any[] = [];

    try {
      if (!project.apiSpec) throw new Error('Project has no imported API spec');

      const context: ScanContext = this.buildContext(project, assessmentId ?? 'single-run', pluginConfig);

      const resultPromise = plugin.run(context, pluginConfig ?? {});
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Plugin timed out after ${deadline}ms`)), deadline),
      );

      const result = await Promise.race([resultPromise, timeoutPromise]);
      findings = result.findings;
    } catch (error) {
      const isTimeout = error.message.includes('timed out');
      status = isTimeout ? 'TIMEOUT' : 'FAILED';
      errorMessage = error.message;
      this.logger.error(`Plugin ${pluginId} ${status}: ${error.message}`);
    }

    const durationMs = Date.now() - startedAt;

    await this.prisma.pluginExecution.update({
      where: { id: execution.id },
      data: {
        status,
        completedAt: new Date(),
        durationMs,
        findingsCount: findings.length,
        errorMessage,
      },
    });

    return {
      pluginId,
      pluginName: plugin.manifest.name,
      status,
      findingsCount: findings.length,
      durationMs,
      findings,
      error: errorMessage,
      executionId: execution.id,
    };
  }

  /**
   * Safe wrapper used by the scanner pipeline.
   * Executes the plugin, records metrics, returns findings (empty on error — never throws).
   */
  async executeInPipeline(
    plugin: import('../scanner/types/scanner.types').BasePlugin,
    context: ScanContext,
    userId: string,
    pluginConfig: Record<string, any> = {},
  ): Promise<{ findings: any[]; durationMs: number; status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' }> {
    const startedAt = Date.now();
    const execution = await this.prisma.pluginExecution.create({
      data: {
        pluginId: plugin.manifest.id,
        assessmentId: context.assessmentId,
        userId,
        status: 'SUCCESS',
        startedAt: new Date(),
      },
    });

    let status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' = 'SUCCESS';
    let findings: any[] = [];
    let errorMessage: string | undefined;

    try {
      const result = await Promise.race([
        plugin.run(context, pluginConfig),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Plugin timeout')), context.config.timeoutMs * 3),
        ),
      ]);
      findings = result.findings;
    } catch (error) {
      status = error.message.includes('timeout') ? 'TIMEOUT' : 'FAILED';
      errorMessage = error.message;
    }

    const durationMs = Date.now() - startedAt;

    await this.prisma.pluginExecution.update({
      where: { id: execution.id },
      data: { status, completedAt: new Date(), durationMs, findingsCount: findings.length, errorMessage },
    });

    return { findings, durationMs, status };
  }

  private buildContext(project: any, assessmentId: string, _pluginConfig?: Record<string, any>): ScanContext {
    const spec = project.apiSpec;
    const auth = spec.authConfig;

    return {
      assessmentId,
      projectId: project.id,
      baseUrl: project.baseUrl,
      auth: {
        type: auth?.type ?? 'NONE',
        token: auth?.token ?? undefined,
        username: auth?.username ?? undefined,
        password: auth?.password ?? undefined,
        apiKey: auth?.apiKey ?? undefined,
        apiKeyHeader: auth?.apiKeyHeader ?? undefined,
        apiKeyLocation: auth?.apiKeyLocation ?? 'header',
        customHeaders: auth?.customHeaders ?? undefined,
      },
      endpoints: (spec.endpoints ?? []).map((e: any) => ({
        id: e.id,
        path: e.path,
        method: e.method,
        summary: e.summary ?? undefined,
        tags: e.tags ?? [],
        parameters: e.parameters ?? [],
        requestBody: e.requestBody ?? undefined,
        responses: e.responses ?? undefined,
        security: e.security ?? [],
        deprecated: e.deprecated ?? false,
      })),
      config: {
        executionMode: 'manual' as const,
        enableAiAnalysis: false,
        maxRequestsPerEndpoint: 5,
        requestDelayMs: 100,
        timeoutMs: 10000,
      },
    };
  }
}
