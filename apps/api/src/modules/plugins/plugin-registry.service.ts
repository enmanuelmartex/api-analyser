import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BasePlugin } from '../scanner/types/scanner.types';
import { PluginCategory, PluginManifest } from '../scanner/types/plugin-manifest.types';
import { collectDeclaredRuleIds, findRuleDeclarationProblems } from './rule-declarations.util';
import { computeOwaspCoverage, type OwaspCoverageSummary } from './owasp-coverage';

// ─── Built-in plugins ──────────────────────────────────────────────────────
import { SecurityHeadersPlugin } from '../scanner/plugins/headers/security-headers.plugin';
import { CorsPlugin } from '../scanner/plugins/cors/cors.plugin';
import { BrokenAuthPlugin } from '../scanner/plugins/authentication/broken-auth.plugin';
import { JwtAnalysisPlugin } from '../scanner/plugins/jwt/jwt-analysis.plugin';
import { BolaPlugin } from '../scanner/plugins/authorization/bola.plugin';
import { BflaPlugin } from '../scanner/plugins/authorization/bfla.plugin';
import { MassAssignmentPlugin } from '../scanner/plugins/mass-assignment/mass-assignment.plugin';
import { RateLimitPlugin } from '../scanner/plugins/rate-limit/rate-limit.plugin';
import { SensitiveDataPlugin } from '../scanner/plugins/sensitive-data/sensitive-data.plugin';
import { SsrfPlugin } from '../scanner/plugins/ssrf/ssrf.plugin';
import { BusinessFlowsPlugin } from '../scanner/plugins/business-flows/business-flows.plugin';
import { InventoryPlugin } from '../scanner/plugins/inventory/inventory.plugin';
import { ApiConsumptionPlugin } from '../scanner/plugins/api-consumption/api-consumption.plugin';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PluginWithMeta {
  plugin: BasePlugin;
  manifest: PluginManifest;
}

/**
 * The built-in security checks, in registration order.
 *
 * Exported so that anything needing the real set — notably the OWASP coverage
 * assertion — reads the same list the registry does. A second hand-maintained
 * copy is exactly how the product came to claim eleven checks while shipping
 * ten.
 */
export function createBuiltinPlugins(): BasePlugin[] {
  return [
    new SecurityHeadersPlugin(),
    new CorsPlugin(),
    new BrokenAuthPlugin(),
    new JwtAnalysisPlugin(),
    new BolaPlugin(),
    new BflaPlugin(),
    new MassAssignmentPlugin(),
    new RateLimitPlugin(),
    new SensitiveDataPlugin(),
    new SsrfPlugin(),
    new BusinessFlowsPlugin(),
    new InventoryPlugin(),
    new ApiConsumptionPlugin(),
  ];
}

// ─── Registry ──────────────────────────────────────────────────────────────

@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistryService.name);
  private readonly registry = new Map<string, BasePlugin>();
  private declaredRuleIds: Set<string> = new Set();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.registerBuiltins();
    this.validateRuleDeclarations();
    await this.syncToDatabase();
  }

  /**
   * Rejects malformed rule declarations at boot, before any scan can run.
   *
   * Rule ids are part of the issue fingerprint, so a duplicate or an unstable id
   * silently merges or splits vulnerabilities across the whole product. Failing
   * startup is the correct response — a bad rule id corrupts data quietly.
   */
  private validateRuleDeclarations(): void {
    const manifests = this.getAllManifests();
    const problems = findRuleDeclarationProblems(manifests);

    if (problems.length > 0) {
      throw new Error(
        'Invalid plugin rule declarations — refusing to start:\n' +
          problems.map((problem) => `  • ${problem}`).join('\n'),
      );
    }

    this.declaredRuleIds = collectDeclaredRuleIds(manifests);
    this.logger.log(
      `Validated ${this.declaredRuleIds.size} rule ids across ${this.registry.size} plugins`,
    );
  }

  /** True when `ruleId` was declared by `pluginId`'s manifest. */
  isDeclaredRule(pluginId: string, ruleId: string): boolean {
    const plugin = this.registry.get(pluginId);
    return plugin ? plugin.manifest.ruleIds.includes(ruleId) : false;
  }

  /** Every rule id the installed checks can emit. */
  getDeclaredRuleIds(): ReadonlySet<string> {
    return this.declaredRuleIds;
  }

  // ── Registration ──────────────────────────────────────────────────────────

  register(plugin: BasePlugin): void {
    if (this.registry.has(plugin.manifest.id)) {
      this.logger.warn(`Plugin "${plugin.manifest.id}" is already registered — skipping`);
      return;
    }
    this.registry.set(plugin.manifest.id, plugin);
    this.logger.debug(`Registered plugin: ${plugin.manifest.id} v${plugin.manifest.version}`);
  }

  private registerBuiltins(): void {
    const builtins = createBuiltinPlugins();

    for (const plugin of builtins) {
      this.register(plugin);
    }

    this.logger.log(`Registered ${builtins.length} built-in plugins`);
  }

  // ── Sync metadata to DB on startup ───────────────────────────────────────

  private async syncToDatabase(): Promise<void> {
    try {
      for (const plugin of this.registry.values()) {
        const m = plugin.manifest;
        await this.prisma.plugin.upsert({
          where: { id: m.id },
          create: {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            longDescription: m.longDescription,
            author: m.author,
            license: m.license,
            category: this.toPrismaCategory(m.category) as any,
            owaspMappings: m.owaspMappings,
            cweIds: m.cweIds ?? [],
            tags: m.tags,
            isBuiltin: m.isBuiltin,
            isEnabled: true,
            configSchema: m.configFields ? ({ fields: m.configFields } as any) : undefined,
            defaultConfig: m.defaultConfig,
            permissions: m.permissions,
            documentationUrl: m.documentationUrl,
            changelog: m.changelog,
            minimumCoreVersion: m.minimumCoreVersion,
          },
          update: {
            name: m.name,
            version: m.version,
            description: m.description,
            longDescription: m.longDescription,
            author: m.author,
            category: this.toPrismaCategory(m.category) as any,
            owaspMappings: m.owaspMappings,
            cweIds: m.cweIds ?? [],
            tags: m.tags,
            configSchema: m.configFields ? ({ fields: m.configFields } as any) : undefined,
            defaultConfig: m.defaultConfig,
            permissions: m.permissions,
          },
        });
      }
      this.logger.log(`Synced ${this.registry.size} plugins to database`);
    } catch (error) {
      this.logger.error(`Failed to sync plugins to DB: ${error.message}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Maps TypeScript PluginCategory display value ('Headers') → Prisma DB key ('HEADERS'). */
  private toPrismaCategory(category: string): string {
    return (
      Object.entries(PluginCategory).find(([, v]) => v === category)?.[0] ??
      category.toUpperCase().replace(/\s+/g, '_')
    );
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getAll(): BasePlugin[] {
    return Array.from(this.registry.values());
  }

  getById(id: string): BasePlugin | undefined {
    return this.registry.get(id);
  }

  getAllManifests(): PluginManifest[] {
    return this.getAll().map((p) => p.manifest);
  }

  /**
   * OWASP API Top 10 coverage as it actually stands, derived from manifests.
   *
   * The single source the UI, the reports and the docs all read, so a coverage
   * claim can never be written by hand again.
   */
  getOwaspCoverage(): OwaspCoverageSummary {
    return computeOwaspCoverage(this.getAllManifests());
  }

  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Returns plugins that are enabled for a given user.
   * Priority: PluginUserConfig.isEnabled → Plugin.isEnabled (global default).
   */
  async getEnabledForUser(userId: string): Promise<BasePlugin[]> {
    const [globalPlugins, userConfigs] = await Promise.all([
      this.prisma.plugin.findMany({ select: { id: true, isEnabled: true } }),
      this.prisma.pluginUserConfig.findMany({
        where: { userId },
        select: { pluginId: true, isEnabled: true },
      }),
    ]);

    const userConfigMap = new Map(userConfigs.map((c) => [c.pluginId, c.isEnabled]));

    return globalPlugins
      .filter((p) => {
        if (userConfigMap.has(p.id)) return userConfigMap.get(p.id);
        return p.isEnabled;
      })
      .map((p) => this.registry.get(p.id))
      .filter((p): p is BasePlugin => p !== undefined);
  }

  /**
   * Returns plugins that are globally enabled (no user context — e.g., scheduled assessments).
   * Respects Plugin.isEnabled but ignores PluginUserConfig.
   */
  async getEnabledGlobally(): Promise<BasePlugin[]> {
    const globalPlugins = await this.prisma.plugin.findMany({
      where: { isEnabled: true },
      select: { id: true },
    });

    return globalPlugins
      .map((p) => this.registry.get(p.id))
      .filter((p): p is BasePlugin => p !== undefined);
  }

  getByIds(pluginIds: string[]): BasePlugin[] {
    return pluginIds
      .map((id) => this.registry.get(id))
      .filter((p): p is BasePlugin => p !== undefined);
  }

  /**
   * Returns user-specific config for a plugin (merged with defaults).
   */
  async getPluginConfig(pluginId: string, userId: string): Promise<Record<string, any>> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) return {};

    const defaults = plugin.manifest.defaultConfig ?? {};

    const userConfig = await this.prisma.pluginUserConfig.findUnique({
      where: { pluginId_userId: { pluginId, userId } },
      select: { config: true },
    });

    return { ...defaults, ...(userConfig?.config as Record<string, any> ?? {}) };
  }
}
