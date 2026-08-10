import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import type { OwaspCoverageSummary } from '../plugins/owasp-coverage';
import { appBrand } from '../../brand/brand';

/**
 * Facts about this deployment, read from the running system.
 *
 * Settings → System previously rendered a hand-written list: "11 OWASP Plugins
 * Active" alongside a check list that showed SSRF as disabled while it was
 * enabled in the database, and omitted three OWASP categories entirely. None of
 * it was wired to anything, so it stayed wrong through every change.
 *
 * Everything here is derived at request time. There is no literal in this file
 * that describes capability.
 */

export interface SystemCheckState {
  id: string;
  name: string;
  category: string;
  owaspMappings: string[];
  ruleCount: number;
  /** Global enablement from the database, not a manifest default. */
  isEnabled: boolean;
}

export interface SystemInfo {
  product: {
    name: string;
    version: string;
    tagline: string;
    domain: string;
  };
  runtime: {
    apiFramework: string;
    bunVersion: string | null;
    nodeVersion: string;
    uptimeSeconds: number;
    environment: string;
  };
  securityChecks: {
    total: number;
    enabled: number;
    totalRules: number;
    checks: SystemCheckState[];
  };
  owasp: OwaspCoverageSummary;
}

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
  ) {}

  async getInfo(): Promise<SystemInfo> {
    const manifests = this.registry.getAllManifests();

    // Enablement lives in the database and is editable, so it must be read
    // rather than assumed from the manifest.
    const rows = await this.prisma.plugin.findMany({
      select: { id: true, isEnabled: true },
    });
    const enabledById = new Map(rows.map((row) => [row.id, row.isEnabled]));

    const checks: SystemCheckState[] = manifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      category: manifest.category,
      owaspMappings: manifest.owaspMappings,
      ruleCount: manifest.ruleIds.length,
      // A check present in code but not yet synced to the database has never
      // been disabled, so it counts as enabled.
      isEnabled: enabledById.get(manifest.id) ?? true,
    }));

    return {
      product: {
        name: appBrand.name,
        version: process.env.npm_package_version ?? '0.1.0',
        tagline: appBrand.tagline,
        domain: appBrand.domain,
      },
      runtime: {
        apiFramework: 'NestJS 10',
        bunVersion: process.versions.bun ?? null,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV ?? 'development',
      },
      securityChecks: {
        total: checks.length,
        enabled: checks.filter((check) => check.isEnabled).length,
        totalRules: checks.reduce((total, check) => total + check.ruleCount, 0),
        checks,
      },
      owasp: this.registry.getOwaspCoverage(),
    };
  }
}
