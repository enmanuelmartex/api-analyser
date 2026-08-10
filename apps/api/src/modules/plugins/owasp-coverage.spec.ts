import { describe, expect, it } from 'bun:test';
import { computeOwaspCoverage, OWASP_API_TOP_10_2023 } from './owasp-coverage';
import { createBuiltinPlugins } from './plugin-registry.service';
import type { PluginManifest } from '../scanner/types/plugin-manifest.types';

/**
 * These tests are the guard against the product overstating what it tests.
 *
 * The UI once claimed "11 OWASP Plugins — Full API Top 10 2023 coverage" with
 * ten checks covering seven categories. Nothing failed, because the claim was a
 * string in a component. Coverage is now derived, and asserted here.
 *
 * Every category has a check today, which makes the guard more important rather
 * than less: "10/10" is exactly the number that tempts a product into implying
 * completeness. The assertions below pin down that a category counts as covered
 * only because a manifest declares it, and that the categories whose checks can
 * reach only part of their subject say so.
 */

function manifest(id: string, owaspMappings: string[], ruleIds: string[] = ['x.rule']): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: '',
    author: 'test',
    license: 'MIT',
    category: 'Headers',
    owaspMappings,
    tags: [],
    supportedApiTypes: ['REST'],
    permissions: [],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'x',
    ruleIds,
  } as unknown as PluginManifest;
}

describe('OWASP category definitions', () => {
  it('declares exactly the ten 2023 categories, in order', () => {
    expect(OWASP_API_TOP_10_2023).toHaveLength(10);
    expect(OWASP_API_TOP_10_2023.map((c) => c.id)).toEqual([
      'API1:2023',
      'API2:2023',
      'API3:2023',
      'API4:2023',
      'API5:2023',
      'API6:2023',
      'API7:2023',
      'API8:2023',
      'API9:2023',
      'API10:2023',
    ]);
  });

  it('gives every category a gap reason, so an uncovered one can always explain itself', () => {
    for (const category of OWASP_API_TOP_10_2023) {
      expect(category.gapReason.length).toBeGreaterThan(0);
    }
  });

  /**
   * The categories whose checks are bounded by what a black-box scan can see.
   * If a note is ever deleted, "covered" starts implying more than it should,
   * so the list is pinned rather than left to editorial discretion.
   */
  it('qualifies the categories a check can only partly reach', () => {
    const noted = OWASP_API_TOP_10_2023.filter((c) => c.scopeNote).map((c) => c.id);

    expect(noted).toEqual(['API6:2023', 'API9:2023', 'API10:2023']);
  });
});

describe('computeOwaspCoverage', () => {
  it('reports nothing covered for an empty registry — never a default of full', () => {
    const coverage = computeOwaspCoverage([]);

    expect(coverage.coveredCount).toBe(0);
    expect(coverage.label).toBe('0/10');
    expect(coverage.categories.every((c) => c.status === 'NOT_COVERED')).toBe(true);
  });

  it('marks a category covered only when a check declares it', () => {
    const coverage = computeOwaspCoverage([manifest('bola', ['API1:2023'])]);

    const api1 = coverage.categories.find((c) => c.id === 'API1:2023')!;
    const api2 = coverage.categories.find((c) => c.id === 'API2:2023')!;

    expect(api1.status).toBe('COVERED');
    expect(api1.checkIds).toEqual(['bola']);
    expect(api1.gapReason).toBeUndefined();

    expect(api2.status).toBe('NOT_COVERED');
    expect(api2.checkIds).toEqual([]);
    expect(api2.gapReason).toBeTruthy();
  });

  it('credits a check to every category it declares', () => {
    const coverage = computeOwaspCoverage([
      manifest('sensitive-data', ['API3:2023', 'API8:2023']),
    ]);

    expect(coverage.coveredCount).toBe(2);
    expect(coverage.categories.find((c) => c.id === 'API3:2023')!.checkIds).toEqual([
      'sensitive-data',
    ]);
    expect(coverage.categories.find((c) => c.id === 'API8:2023')!.checkIds).toEqual([
      'sensitive-data',
    ]);
  });

  it('counts a category once even when several checks cover it', () => {
    const coverage = computeOwaspCoverage([
      manifest('cors', ['API8:2023'], ['cors.a', 'cors.b']),
      manifest('headers', ['API8:2023'], ['headers.a']),
    ]);

    const api8 = coverage.categories.find((c) => c.id === 'API8:2023')!;

    expect(coverage.coveredCount).toBe(1);
    expect(api8.checkIds).toEqual(['cors', 'headers']);
    expect(api8.ruleCount).toBe(3);
  });

  it('swaps the gap reason for a scope note once a category is covered', () => {
    const uncovered = computeOwaspCoverage([]).categories.find((c) => c.id === 'API9:2023')!;
    const covered = computeOwaspCoverage([manifest('inventory', ['API9:2023'])]).categories.find(
      (c) => c.id === 'API9:2023',
    )!;

    // Uncovered: nothing was tested, and the row must say why.
    expect(uncovered.gapReason).toBeTruthy();
    expect(uncovered.scopeNote).toBeUndefined();

    // Covered: a check ran, and the row must still say what it could not reach.
    expect(covered.gapReason).toBeUndefined();
    expect(covered.scopeNote).toContain('host under assessment');
  });

  it('leaves a covered category with no known limits unqualified', () => {
    const api1 = computeOwaspCoverage([manifest('bola', ['API1:2023'])]).categories.find(
      (c) => c.id === 'API1:2023',
    )!;

    expect(api1.status).toBe('COVERED');
    expect(api1.scopeNote).toBeUndefined();
  });

  it('totals checks and rules across the registry', () => {
    const coverage = computeOwaspCoverage([
      manifest('a', ['API1:2023'], ['a.1', 'a.2']),
      manifest('b', ['API2:2023'], ['b.1']),
    ]);

    expect(coverage.checkCount).toBe(2);
    expect(coverage.ruleCount).toBe(3);
  });
});

describe('the shipped registry', () => {
  const coverage = computeOwaspCoverage(createBuiltinPlugins().map((p) => p.manifest));

  /**
   * These assertions state what the product genuinely does today. They are
   * meant to fail when a check is added or removed — that is the moment the
   * README, the About screen and the coverage matrix must be revisited, and
   * they all read this same computation.
   */
  it('ships thirteen security checks', () => {
    expect(coverage.checkCount).toBe(13);
  });

  it('has a check behind every category of the 2023 edition', () => {
    expect(coverage.coveredCount).toBe(10);
    expect(coverage.label).toBe('10/10');
    expect(coverage.categories.every((c) => c.status === 'COVERED')).toBe(true);
  });

  it('names the check that covers each of the three categories added last', () => {
    const checksFor = (id: string) => coverage.categories.find((c) => c.id === id)!.checkIds;

    expect(checksFor('API6:2023')).toContain('business-flows');
    expect(checksFor('API9:2023')).toContain('inventory');
    expect(checksFor('API10:2023')).toContain('api-consumption');
  });

  /**
   * 10/10 is the number a product is most tempted to round up from. It is only
   * defensible while each of those three rows still carries the sentence saying
   * what its check cannot see.
   */
  it('qualifies the three categories whose checks are bounded by black-box visibility', () => {
    for (const id of ['API6:2023', 'API9:2023', 'API10:2023']) {
      const category = coverage.categories.find((c) => c.id === id)!;

      expect(category.status).toBe('COVERED');
      expect(category.scopeNote).toBeTruthy();
    }
  });

  it('maps every covered category to at least one real check and rule', () => {
    for (const category of coverage.categories.filter((c) => c.status === 'COVERED')) {
      expect(category.checkIds.length).toBeGreaterThan(0);
      expect(category.ruleCount).toBeGreaterThan(0);
    }
  });
});
