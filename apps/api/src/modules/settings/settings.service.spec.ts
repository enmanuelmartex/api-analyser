import { beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from './settings.service';
import { getSettingDefinition, isSettingKey, SETTING_DEFINITIONS } from './settings.registry';

/**
 * Resolution order and validation.
 *
 * The precedence rule — database → environment → built-in default — is what
 * makes "reset to default" meaningful and what stops a UI change from being
 * silently reverted by a container restart. The validation is what makes
 * `PATCH /settings` safe to expose: without it the endpoint writes arbitrary
 * rows into `system_settings`.
 */

type Row = { key: string; value: unknown };

function makeService(options: { rows?: Row[]; env?: Record<string, string> } = {}) {
  const rows = options.rows ?? [];
  const env = options.env ?? {};
  const emitted: { name: string; payload: unknown }[] = [];
  const upserts: { key: string; value: unknown }[] = [];
  const deletes: string[] = [];

  const prisma = {
    systemSetting: {
      findMany: async () => rows,
      upsert: async ({ where, create }: any) => {
        upserts.push({ key: where.key, value: create.value });
        return create;
      },
      deleteMany: async ({ where }: any) => {
        deletes.push(where.key);
        return { count: 1 };
      },
    },
  };

  const config = { get: (key: string) => env[key] };
  const events = { emit: (name: string, payload: unknown) => emitted.push({ name, payload }) };

  const service = new SettingsService(prisma as any, config as any, events as any);
  return { service, emitted, upserts, deletes };
}

describe('settings registry', () => {
  it('has a unique key, an env variable and a fallback for every definition', () => {
    const keys = SETTING_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.env.length).toBeGreaterThan(0);
      expect(definition.fallback).toBeDefined();
      if (definition.kind === 'number') {
        expect(definition.min).toBeDefined();
        expect(definition.max).toBeDefined();
        expect(definition.fallback as number).toBeGreaterThanOrEqual(definition.min!);
        expect(definition.fallback as number).toBeLessThanOrEqual(definition.max!);
      }
    }
  });

  it('rejects keys that are not in the catalogue', () => {
    expect(isSettingKey('logs.retentionDays')).toBe(true);
    expect(isSettingKey('logs.somethingInvented')).toBe(false);
    expect(getSettingDefinition('nope')).toBeUndefined();
  });
});

describe('resolution order', () => {
  it('falls back to the built-in default when neither the database nor the environment has a value', async () => {
    const { service } = makeService();
    await service.refresh();

    expect(await service.getNumber('logs.retentionDays')).toBe(30);
    const all = await service.getAll();
    expect(all.find((s) => s.key === 'logs.retentionDays')!.source).toBe('default');
  });

  it('prefers the environment over the built-in default', async () => {
    const { service } = makeService({ env: { LOG_RETENTION_DAYS: '14' } });
    await service.refresh();

    expect(await service.getNumber('logs.retentionDays')).toBe(14);
    const all = await service.getAll();
    expect(all.find((s) => s.key === 'logs.retentionDays')!.source).toBe('environment');
  });

  it('prefers a database override over the environment', async () => {
    const { service } = makeService({
      env: { LOG_RETENTION_DAYS: '14' },
      rows: [{ key: 'logs.retentionDays', value: { value: 60 } }],
    });
    await service.refresh();

    expect(await service.getNumber('logs.retentionDays')).toBe(60);
    const all = await service.getAll();
    expect(all.find((s) => s.key === 'logs.retentionDays')!.source).toBe('database');
  });

  it('ignores an unparseable environment value rather than propagating NaN', async () => {
    const { service } = makeService({ env: { LOG_RETENTION_DAYS: 'not-a-number' } });
    await service.refresh();

    expect(await service.getNumber('logs.retentionDays')).toBe(30);
  });

  it('ignores an out-of-range environment value', async () => {
    // 0 is below the minimum of 1 — accepting it would mean "delete everything
    // immediately" from a typo in an env file.
    const { service } = makeService({ env: { LOG_RETENTION_DAYS: '0' } });
    await service.refresh();

    expect(await service.getNumber('logs.retentionDays')).toBe(30);
  });

  it('parses boolean environment values in both spellings', async () => {
    const on = makeService({ env: { LOG_COLLECTION_ENABLED: 'true' } });
    const off = makeService({ env: { LOG_COLLECTION_ENABLED: 'false' } });
    const numeric = makeService({ env: { LOG_COLLECTION_ENABLED: '0' } });
    await Promise.all([on.service.refresh(), off.service.refresh(), numeric.service.refresh()]);

    expect(await on.service.getBoolean('logs.collectionEnabled')).toBe(true);
    expect(await off.service.getBoolean('logs.collectionEnabled')).toBe(false);
    expect(await numeric.service.getBoolean('logs.collectionEnabled')).toBe(false);
  });
});

describe('update', () => {
  let harness: ReturnType<typeof makeService>;

  beforeEach(async () => {
    harness = makeService();
    await harness.service.refresh();
  });

  it('rejects an unknown key instead of silently dropping it', async () => {
    // Silently ignoring half a form submission leaves the operator believing a
    // setting was saved.
    await expect(harness.service.update({ 'logs.madeUp': 5 })).rejects.toThrow(/Unknown setting/);
  });

  it('rejects a value outside the definition range', async () => {
    await expect(harness.service.update({ 'logs.retentionDays': 99_999 })).rejects.toThrow();
    await expect(harness.service.update({ 'logs.retentionDays': 0 })).rejects.toThrow();
  });

  it('rejects a non-boolean for a boolean setting', async () => {
    await expect(
      harness.service.update({ 'logs.collectionEnabled': 'maybe' }),
    ).rejects.toThrow();
  });

  it('returns the old and new value for each real change', async () => {
    const changes = await harness.service.update({ 'logs.retentionDays': 60 }, 'user-1');

    expect(changes).toEqual([{ key: 'logs.retentionDays', from: 30, to: 60 }]);
    expect(harness.upserts).toHaveLength(1);
  });

  it('writes nothing when the submitted value already matches', async () => {
    // Otherwise every form submission produces an audit event claiming a change.
    const changes = await harness.service.update({ 'logs.retentionDays': 30 });

    expect(changes).toEqual([]);
    expect(harness.upserts).toHaveLength(0);
    expect(harness.emitted).toHaveLength(0);
  });

  it('emits settings.changed once, carrying every change', async () => {
    await harness.service.update(
      { 'logs.retentionDays': 60, 'logs.collectionEnabled': false },
      'user-1',
    );

    expect(harness.emitted).toHaveLength(1);
    expect(harness.emitted[0].name).toBe('settings.changed');
    expect((harness.emitted[0].payload as any).changes).toHaveLength(2);
    expect((harness.emitted[0].payload as any).actorId).toBe('user-1');
  });

  it('coerces a numeric string, which is what an HTML number input submits', async () => {
    const changes = await harness.service.update({ 'logs.retentionDays': '45' });

    expect(changes[0].to).toBe(45);
  });
});

describe('reset', () => {
  it('drops the override so the environment value applies again', async () => {
    const { service, deletes, emitted } = makeService({
      env: { LOG_RETENTION_DAYS: '14' },
      rows: [{ key: 'logs.retentionDays', value: { value: 60 } }],
    });
    await service.refresh();
    expect(await service.getNumber('logs.retentionDays')).toBe(60);

    await service.reset('logs.retentionDays', 'user-1');

    expect(deletes).toContain('logs.retentionDays');
    expect(emitted.at(-1)!.name).toBe('settings.changed');
  });
});
