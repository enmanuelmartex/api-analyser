import type { PluginManifest } from '../scanner/types/plugin-manifest.types';
import {
  collectDeclaredRuleIds,
  findRuleDeclarationProblems,
} from './rule-declarations.util';

function manifest(overrides: Partial<PluginManifest>): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'test',
    author: 'IASA',
    license: 'MIT',
    category: 'Headers' as any,
    owaspMappings: ['API8:2023'],
    tags: [],
    supportedApiTypes: ['REST'],
    permissions: [],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'test',
    ruleIds: ['test.some-rule'],
    ...overrides,
  } as PluginManifest;
}

describe('findRuleDeclarationProblems', () => {
  it('accepts a well-formed declaration', () => {
    expect(findRuleDeclarationProblems([manifest({})])).toEqual([]);
  });

  it('rejects a missing namespace', () => {
    const problems = findRuleDeclarationProblems([manifest({ ruleNamespace: '' })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ruleNamespace');
  });

  it('rejects a plugin that declares no rules', () => {
    // A plugin able to emit findings but declaring no rules could persist a
    // finding with no stable identity.
    const problems = findRuleDeclarationProblems([manifest({ ruleIds: [] })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no ruleIds');
  });

  it.each([[''], ['   ']])('rejects an empty ruleId (%p)', (ruleId) => {
    const problems = findRuleDeclarationProblems([manifest({ ruleIds: [ruleId] })]);
    expect(problems[0]).toContain('empty ruleId');
  });

  it('rejects an unnamespaced ruleId', () => {
    const problems = findRuleDeclarationProblems([manifest({ ruleIds: ['missing-hsts'] })]);
    expect(problems[0]).toContain('not namespaced');
  });

  it('rejects a ruleId whose namespace does not match the declared one', () => {
    const problems = findRuleDeclarationProblems([
      manifest({ ruleNamespace: 'headers', ruleIds: ['cors.wildcard-origin'] }),
    ]);
    expect(problems[0]).toContain('does not start with its declared namespace');
  });

  it('rejects a duplicate ruleId inside one plugin', () => {
    const problems = findRuleDeclarationProblems([
      manifest({ ruleIds: ['test.dupe', 'test.dupe'] }),
    ]);
    expect(problems[0]).toContain('more than once');
  });

  it('rejects the same ruleId declared by two plugins', () => {
    // A collision here would merge two unrelated vulnerabilities into one issue.
    const problems = findRuleDeclarationProblems([
      manifest({ id: 'plugin-a', ruleNamespace: 'shared', ruleIds: ['shared.rule'] }),
      manifest({ id: 'plugin-b', ruleNamespace: 'shared', ruleIds: ['shared.rule'] }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('plugin-a');
    expect(problems[0]).toContain('plugin-b');
  });

  it('reports every problem rather than stopping at the first', () => {
    const problems = findRuleDeclarationProblems([
      manifest({ id: 'a', ruleNamespace: '' }),
      manifest({ id: 'b', ruleIds: [] }),
      manifest({ id: 'c', ruleIds: ['unnamespaced'] }),
    ]);
    expect(problems).toHaveLength(3);
  });
});

describe('collectDeclaredRuleIds', () => {
  it('collects across plugins and skips blanks', () => {
    const ids = collectDeclaredRuleIds([
      manifest({ id: 'a', ruleNamespace: 'a', ruleIds: ['a.one', 'a.two'] }),
      manifest({ id: 'b', ruleNamespace: 'b', ruleIds: ['b.one', ''] }),
    ]);
    expect([...ids].sort()).toEqual(['a.one', 'a.two', 'b.one']);
  });
});

describe('the real built-in plugins', () => {
  it('declare valid, non-colliding rules', async () => {
    // Guards against a maintainer adding a plugin with a colliding or
    // unnamespaced rule id — the registry throws at boot, so catch it here.
    const { PluginRegistryService } = await import('./plugin-registry.service');
    const registry = new PluginRegistryService({} as any);
    (registry as any).registerBuiltins();

    const manifests = registry.getAllManifests();
    expect(manifests).toHaveLength(13);
    expect(findRuleDeclarationProblems(manifests)).toEqual([]);
  });

  it('declare every rule id exactly once across every plugin', async () => {
    const { PluginRegistryService } = await import('./plugin-registry.service');
    const registry = new PluginRegistryService({} as any);
    (registry as any).registerBuiltins();

    const all = registry.getAllManifests().flatMap((m) => m.ruleIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(22);
  });
});
