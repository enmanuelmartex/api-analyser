import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';

@Injectable()
export class PluginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
  ) {}

  // ── List all plugins with user-specific state ─────────────────────────────

  async findAll(userId: string) {
    const [dbPlugins, userConfigs, execStats] = await Promise.all([
      this.prisma.plugin.findMany({ orderBy: { category: 'asc' } }),
      this.prisma.pluginUserConfig.findMany({
        where: { userId },
        select: { pluginId: true, isEnabled: true, config: true },
      }),
      this.prisma.pluginExecution.groupBy({
        by: ['pluginId'],
        _count: { id: true },
        _avg: { durationMs: true },
        where: { userId },
      }),
    ]);

    const userConfigMap = new Map(userConfigs.map((c) => [c.pluginId, c]));
    const statsMap = new Map(execStats.map((s) => [s.pluginId, s]));

    return dbPlugins.map((p) => {
      const userCfg = userConfigMap.get(p.id);
      const stats = statsMap.get(p.id);
      return {
        ...p,
        isEnabled: userCfg !== undefined ? userCfg.isEnabled : p.isEnabled,
        userConfig: (userCfg?.config as Record<string, any>) ?? null,
        stats: {
          totalExecutions: stats?._count?.id ?? 0,
          avgDurationMs: Math.round(stats?._avg?.durationMs ?? 0),
        },
      };
    });
  }

  // ── Get single plugin with full stats ────────────────────────────────────

  async findOne(pluginId: string, userId: string) {
    const plugin = await this.prisma.plugin.findUnique({ where: { id: pluginId } });
    if (!plugin) throw new NotFoundException(`Plugin "${pluginId}" not found`);

    const [userConfig, recentExecutions, findingStats] = await Promise.all([
      this.prisma.pluginUserConfig.findUnique({
        where: { pluginId_userId: { pluginId, userId } },
      }),
      this.prisma.pluginExecution.findMany({
        where: { pluginId, userId },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      // Current issues attributed to this check, not every historical
      // detection: a check that finds one real problem and is run fifty times
      // should not report fifty findings.
      this.prisma.securityIssue.groupBy({
        by: ['severity'],
        _count: { id: true },
        where: { pluginId, project: { isActive: true } },
      }),
    ]);

    const totalExecutions = recentExecutions.length;
    const successful = recentExecutions.filter((e) => e.status === 'SUCCESS').length;
    const avgDuration = totalExecutions
      ? Math.round(recentExecutions.reduce((s, e) => s + (e.durationMs ?? 0), 0) / totalExecutions)
      : 0;

    return {
      ...plugin,
      /*
       * `findUnique` resolves to `null`, not `undefined`, when there is no
       * per-user row. The previous `userConfig !== undefined` test was
       * therefore always true and dereferenced null, so this endpoint returned
       * 500 for every user who had never overridden this check — which is
       * every user by default. That is why nothing in the UI consumed it.
       */
      isEnabled: userConfig?.isEnabled ?? plugin.isEnabled,
      userConfig: (userConfig?.config as Record<string, any>) ?? null,
      stats: {
        totalExecutions,
        successRate: totalExecutions ? Math.round((successful / totalExecutions) * 100) : 0,
        avgDurationMs: avgDuration,
        findingsBySeverity: Object.fromEntries(findingStats.map((s) => [s.severity, s._count.id])),
      },
      recentExecutions,
    };
  }

  // ── Toggle enable / disable for a user ───────────────────────────────────

  async toggle(pluginId: string, userId: string, isEnabled: boolean) {
    if (!this.registry.has(pluginId)) throw new NotFoundException(`Plugin "${pluginId}" not found`);

    return this.prisma.pluginUserConfig.upsert({
      where: { pluginId_userId: { pluginId, userId } },
      create: { pluginId, userId, isEnabled },
      update: { isEnabled },
    });
  }

  // ── Save user-specific config for a plugin ────────────────────────────────

  async saveConfig(pluginId: string, userId: string, config: Record<string, any>) {
    if (!this.registry.has(pluginId)) throw new NotFoundException(`Plugin "${pluginId}" not found`);

    return this.prisma.pluginUserConfig.upsert({
      where: { pluginId_userId: { pluginId, userId } },
      create: { pluginId, userId, config },
      update: { config },
    });
  }

  // ── Execution history for a plugin ───────────────────────────────────────

  async getExecutionHistory(pluginId: string, userId: string, limit = 50) {
    return this.prisma.pluginExecution.findMany({
      where: { pluginId, userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  // ── Issues detected by a specific check ───────────────────────────────────

  /**
   * Persistent issues this check is responsible for.
   *
   * Returns issues rather than raw detections so the same vulnerability appears
   * once regardless of how many scans found it.
   */
  async getIssues(pluginId: string, limit = 50) {
    return this.prisma.securityIssue.findMany({
      where: {
        pluginId,
        project: { isActive: true },
      },
      include: {
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: limit,
    });
  }
}
