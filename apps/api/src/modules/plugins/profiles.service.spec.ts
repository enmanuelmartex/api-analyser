import { describe, expect, it } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfilesService, SYSTEM_PROFILES } from './profiles.service';
import { createBuiltinPlugins } from './plugin-registry.service';
import { computeOwaspCoverage } from './owasp-coverage';

/**
 * Scan profiles must not be able to name checks that do not exist.
 *
 * Nothing validated the selection before: `ProfilesService.create` spread the
 * request body straight into `prisma.scanProfile.create`. A profile naming a
 * removed or misspelled check saved cleanly and only failed later, at the
 * moment a scan was launched with it, with an error that pointed at the scan.
 */

function registryDouble(installed: string[]) {
  return {
    has: (id: string) => installed.includes(id),
  } as any;
}

function prismaDouble(overrides: Record<string, any> = {}) {
  return {
    scanProfile: {
      create: async ({ data }: any) => ({ id: 'new-profile', ...data }),
      findUnique: async () => null,
      update: async ({ data }: any) => ({ id: 'p1', ...data }),
      ...(overrides.scanProfile ?? {}),
    },
  } as any;
}

const INSTALLED = ['cors', 'security-headers', 'bola'];

describe('ProfilesService.create', () => {
  it('accepts a selection of installed checks', async () => {
    const service = new ProfilesService(prismaDouble(), registryDouble(INSTALLED));

    const profile = await service.create('user-1', {
      name: 'Headers only',
      enabledPlugins: ['cors', 'security-headers'],
    } as any);

    expect(profile.enabledPlugins).toEqual(['cors', 'security-headers']);
    expect(profile.isSystem).toBe(false);
    expect(profile.userId).toBe('user-1');
  });

  it('rejects an unknown check id and names it', async () => {
    const service = new ProfilesService(prismaDouble(), registryDouble(INSTALLED));

    const attempt = service.create('user-1', {
      name: 'Broken',
      enabledPlugins: ['cors', 'sql-injection'],
    } as any);

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(/sql-injection/);
  });

  it('lists every unknown id, not just the first', async () => {
    const service = new ProfilesService(prismaDouble(), registryDouble(INSTALLED));

    const attempt = service.create('user-1', {
      name: 'Broken',
      enabledPlugins: ['ghost-a', 'ghost-b'],
    } as any);

    await expect(attempt).rejects.toThrow(/ghost-a, ghost-b/);
  });

  it('rejects a duplicated check id', async () => {
    const service = new ProfilesService(prismaDouble(), registryDouble(INSTALLED));

    await expect(
      service.create('user-1', {
        name: 'Doubled',
        enabledPlugins: ['cors', 'cors'],
      } as any),
    ).rejects.toThrow(/Duplicate/);
  });
});

describe('ProfilesService.update', () => {
  const ownedProfile = { id: 'p1', isSystem: false, userId: 'user-1' };

  it('validates the replacement selection', async () => {
    const service = new ProfilesService(
      prismaDouble({ scanProfile: { findUnique: async () => ownedProfile } }),
      registryDouble(INSTALLED),
    );

    await expect(
      service.update('p1', 'user-1', { enabledPlugins: ['nope'] } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('still refuses to modify a system profile, before validating checks', async () => {
    const service = new ProfilesService(
      prismaDouble({
        scanProfile: { findUnique: async () => ({ ...ownedProfile, isSystem: true }) },
      }),
      registryDouble(INSTALLED),
    );

    // The unknown id would also fail; ownership must be the reported reason.
    await expect(
      service.update('p1', 'user-1', { enabledPlugins: ['nope'] } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('leaves an update that does not touch the selection alone', async () => {
    const service = new ProfilesService(
      prismaDouble({ scanProfile: { findUnique: async () => ownedProfile } }),
      registryDouble(INSTALLED),
    );

    const updated = await service.update('p1', 'user-1', { name: 'Renamed' } as any);
    expect(updated.name).toBe('Renamed');
  });
});

describe('the seeded system profiles', () => {
  const plugins = createBuiltinPlugins();
  const installedIds = plugins.map((plugin) => plugin.manifest.id);

  const profile = (id: string) => SYSTEM_PROFILES.find((p) => p.id === id)!;

  const coverageOf = (pluginIds: string[]) =>
    computeOwaspCoverage(
      plugins
        .filter((plugin) => pluginIds.includes(plugin.manifest.id))
        .map((plugin) => plugin.manifest),
    );

  it('name only checks that are installed', () => {
    // The lists are hand-written; a typo here saves cleanly and only surfaces
    // when a user picks the profile and the scan refuses to start.
    for (const systemProfile of SYSTEM_PROFILES) {
      const unknown = systemProfile.enabledPlugins.filter((id) => !installedIds.includes(id));
      expect({ profile: systemProfile.id, unknown }).toEqual({ profile: systemProfile.id, unknown: [] });
    }
  });

  it('never name the same check twice', () => {
    for (const systemProfile of SYSTEM_PROFILES) {
      expect(new Set(systemProfile.enabledPlugins).size).toBe(systemProfile.enabledPlugins.length);
    }
  });

  it('keeps "Full Scan" meaning every installed check', () => {
    // Its description says "all available security plugins". Adding a check
    // without adding it here would make that sentence false.
    expect([...profile('full-scan').enabledPlugins].sort()).toEqual([...installedIds].sort());
  });

  it('keeps "OWASP API Top 10" genuinely covering the Top 10', () => {
    // The strongest promise any profile makes, and the one a compliance user
    // relies on. It is asserted against the same computation the product ships.
    expect(coverageOf(profile('owasp-api-top10').enabledPlugins).label).toBe('10/10');
  });
});
