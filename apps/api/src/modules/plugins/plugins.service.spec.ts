import { describe, expect, it } from 'bun:test';
import { PluginsService } from './plugins.service';

/**
 * Regression guard for `GET /plugins/:id`.
 *
 * `findOne` decided enablement with `userConfig !== undefined`. Prisma's
 * `findUnique` resolves to `null` when there is no row, so that test was always
 * true and the next expression dereferenced null — the endpoint answered 500
 * for every user who had not overridden the check, which is the default state
 * for all of them. It went unnoticed because no screen called it.
 *
 * The service is exercised against a hand-rolled Prisma double rather than the
 * integration database: the bug is in a single branch of pure logic, and a
 * double makes "no per-user config row" the explicit precondition.
 */

function prismaDouble({
  plugin,
  userConfig,
}: {
  plugin: any;
  userConfig: any;
}) {
  return {
    plugin: {
      findUnique: async () => plugin,
    },
    pluginUserConfig: {
      // Mirrors Prisma: a missing row resolves to null, never undefined.
      findUnique: async () => userConfig,
    },
    pluginExecution: {
      findMany: async () => [],
    },
    securityIssue: {
      groupBy: async () => [],
    },
  } as any;
}

const BASE_PLUGIN = {
  id: 'cors',
  name: 'CORS',
  isEnabled: true,
};

describe('PluginsService.findOne', () => {
  it('falls back to the global default when the user has no config row', async () => {
    const service = new PluginsService(
      prismaDouble({ plugin: BASE_PLUGIN, userConfig: null }),
    );

    const result = await service.findOne('cors', 'user-1');

    expect(result.isEnabled).toBe(true);
    expect(result.userConfig).toBeNull();
  });

  it('does not throw when the check is globally disabled and unconfigured', async () => {
    const service = new PluginsService(
      prismaDouble({ plugin: { ...BASE_PLUGIN, isEnabled: false }, userConfig: null }),
    );

    const result = await service.findOne('cors', 'user-1');

    expect(result.isEnabled).toBe(false);
  });

  it('lets a per-user override win over the global default', async () => {
    const service = new PluginsService(
      prismaDouble({
        plugin: BASE_PLUGIN,
        userConfig: { isEnabled: false, config: { strict: true } },
      }),
    );

    const result = await service.findOne('cors', 'user-1');

    expect(result.isEnabled).toBe(false);
    expect(result.userConfig).toEqual({ strict: true });
  });

  it('honours a user override that re-enables a globally disabled check', async () => {
    const service = new PluginsService(
      prismaDouble({
        plugin: { ...BASE_PLUGIN, isEnabled: false },
        userConfig: { isEnabled: true, config: null },
      }),
    );

    expect((await service.findOne('cors', 'user-1')).isEnabled).toBe(true);
  });
});
