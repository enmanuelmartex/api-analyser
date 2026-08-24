import { Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';

interface CreateProfileDto {
  name: string;
  description?: string;
  icon?: string;
  enabledPlugins: string[];
  pluginConfigs?: Record<string, any>;
}

/**
 * The profiles every installation gets, seeded at boot.
 *
 * Exported so the checks they name can be asserted against the real registry:
 * each of these lists is hand-written, and two of them make a promise in their
 * own description — "all available security plugins", "all OWASP API Security
 * Top 10 categories" — that a typo or a newly added check would quietly break.
 */
export const SYSTEM_PROFILES = [
  {
    id: 'full-scan',
    name: 'Full Scan',
    description: 'Runs all available security plugins. Recommended for complete audits.',
    icon: 'shield',
    enabledPlugins: [
      'security-headers', 'cors', 'broken-authentication', 'jwt-analysis',
      'bola', 'bfla', 'mass-assignment', 'rate-limit', 'sensitive-data', 'ssrf',
      'business-flows', 'inventory', 'api-consumption',
    ],
  },
  {
    id: 'quick-scan',
    name: 'Quick Scan',
    description: 'Fast scan covering the most critical categories. Ideal for CI pipelines.',
    icon: 'zap',
    enabledPlugins: ['security-headers', 'cors', 'broken-authentication', 'sensitive-data'],
  },
  {
    id: 'auth-audit',
    name: 'Authentication Audit',
    description: 'Deep dive into authentication and authorization controls.',
    icon: 'lock',
    enabledPlugins: ['broken-authentication', 'jwt-analysis', 'bola', 'bfla'],
  },
  {
    id: 'headers-audit',
    name: 'Headers Audit',
    description: 'Focuses on HTTP security headers and CORS configuration.',
    icon: 'layers',
    enabledPlugins: ['security-headers', 'cors'],
  },
  {
    id: 'owasp-api-top10',
    name: 'OWASP API Top 10',
    description: 'Covers all OWASP API Security Top 10 categories (2023).',
    icon: 'list',
    // One check per category, in category order, so the profile's name is
    // literally true: every category of the 2023 edition has something behind it.
    enabledPlugins: [
      'bola', 'broken-authentication', 'jwt-analysis', 'mass-assignment',
      'sensitive-data', 'rate-limit', 'bfla', 'business-flows', 'ssrf',
      'security-headers', 'cors', 'inventory', 'api-consumption',
    ],
  },
  {
    id: 'compliance',
    name: 'Compliance Scan',
    description: 'Targets PII/sensitive data exposure and security header requirements.',
    icon: 'check-circle',
    enabledPlugins: ['sensitive-data', 'security-headers', 'cors'],
  },
];

@Injectable()
export class ProfilesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
  ) {}

  /**
   * Rejects a selection containing checks that are not installed.
   *
   * Nothing validated this before, so a profile could be saved naming checks
   * that do not exist. The damage was bounded — `createAndRun` rejects unknown
   * ids before enqueueing — but the user only discovered the broken profile at
   * the moment they tried to scan with it, with an error pointing at the scan
   * rather than at the profile. Failing here names the offending ids instead.
   */
  private assertChecksExist(enabledPlugins?: string[]): void {
    if (!enabledPlugins) return;

    const unknown = enabledPlugins.filter((id) => !this.registry.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown security check${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      );
    }

    const duplicates = enabledPlugins.filter((id, index) => enabledPlugins.indexOf(id) !== index);
    if (duplicates.length > 0) {
      throw new BadRequestException(
        `Duplicate security check${duplicates.length > 1 ? 's' : ''}: ${[...new Set(duplicates)].join(', ')}`,
      );
    }
  }

  async onModuleInit() {
    await this.seedSystemProfiles();
  }

  private async seedSystemProfiles() {
    for (const profile of SYSTEM_PROFILES) {
      await this.prisma.scanProfile.upsert({
        where: { id: profile.id },
        create: { ...profile, isSystem: true },
        update: { name: profile.name, description: profile.description, enabledPlugins: profile.enabledPlugins },
      });
    }
  }

  // ── List all profiles (system + user's own) ───────────────────────────────

  async findAll(userId: string) {
    return this.prisma.scanProfile.findMany({
      where: { OR: [{ isSystem: true }, { userId }] },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // ── Get single profile ────────────────────────────────────────────────────

  async findOne(profileId: string, userId: string) {
    const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
    // Collapsed into one generic 404, same as every other module's ownership
    // check: a 403 here would confirm that some other user's profile id
    // exists, which is exactly the existence leak the rest of the app avoids
    // (compare ProjectsService.assertExists, ScheduledScansService.assertExists).
    if (!profile || (!profile.isSystem && profile.userId !== userId)) {
      throw new NotFoundException('Scan profile not found');
    }
    return profile;
  }

  // ── Create custom profile ─────────────────────────────────────────────────

  async create(userId: string, dto: CreateProfileDto) {
    this.assertChecksExist(dto.enabledPlugins);

    return this.prisma.scanProfile.create({
      data: { ...dto, userId, isSystem: false },
    });
  }

  // ── Update custom profile ─────────────────────────────────────────────────

  async update(profileId: string, userId: string, dto: Partial<CreateProfileDto>) {
    const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
    if (!profile || (!profile.isSystem && profile.userId !== userId)) {
      throw new NotFoundException('Scan profile not found');
    }
    if (profile.isSystem) throw new ForbiddenException('Cannot modify system profiles');

    this.assertChecksExist(dto.enabledPlugins);

    return this.prisma.scanProfile.update({ where: { id: profileId }, data: dto });
  }

  // ── Delete custom profile ─────────────────────────────────────────────────

  async remove(profileId: string, userId: string) {
    const profile = await this.prisma.scanProfile.findUnique({ where: { id: profileId } });
    if (!profile || (!profile.isSystem && profile.userId !== userId)) {
      throw new NotFoundException('Scan profile not found');
    }
    if (profile.isSystem) throw new ForbiddenException('Cannot delete system profiles');

    await this.prisma.scanProfile.delete({ where: { id: profileId } });
    return { deleted: true };
  }
}
