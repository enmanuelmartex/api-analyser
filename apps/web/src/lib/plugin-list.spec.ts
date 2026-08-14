import { describe, expect, it } from 'bun:test';
import type { Plugin } from '@/types';
import {
  ALL_CATEGORIES,
  EMPTY_PLUGIN_FILTERS,
  filterPlugins,
  getPluginCategories,
  hasActivePluginFilters,
  parsePluginFilters,
  pluginsHref,
  serializePluginFilters,
} from './plugin-list';

/**
 * The contract between the Security Checks summary cards and the check list.
 *
 * The "Enabled" and "Disabled" cards are links; the page filters with
 * `filterPlugins`. Both halves are asserted here so a card cannot advertise a
 * count the list then contradicts.
 */

const params = (query: string) => new URLSearchParams(query);

function plugin(overrides: Partial<Plugin>): Plugin {
  return {
    id: 'check',
    name: 'Check',
    description: 'A security check',
    category: 'Headers',
    tags: [],
    isEnabled: true,
    ...overrides,
  } as Plugin;
}

const CHECKS = [
  plugin({ id: 'jwt', name: 'JWT validation', category: 'Authentication', isEnabled: true, tags: ['jwt'] }),
  plugin({ id: 'cors', name: 'CORS policy', category: 'Headers', isEnabled: false, tags: ['cors'] }),
  plugin({ id: 'hsts', name: 'HSTS header', category: 'Headers', isEnabled: true, tags: [] }),
];

describe('parsePluginFilters', () => {
  it('returns the empty state for a bare URL', () => {
    expect(parsePluginFilters(params(''))).toEqual(EMPTY_PLUGIN_FILTERS);
  });

  it('reads the availability state case-insensitively', () => {
    expect(parsePluginFilters(params('state=ENABLED')).state).toBe('enabled');
  });

  it('ignores an unknown availability state', () => {
    expect(parsePluginFilters(params('state=broken')).state).toBe('all');
  });

  it('keeps the category verbatim, spaces included', () => {
    expect(parsePluginFilters(params('category=API+Design')).category).toBe('API Design');
  });
});

describe('serializePluginFilters', () => {
  it('omits every default', () => {
    expect(serializePluginFilters(EMPTY_PLUGIN_FILTERS)).toBe('');
  });

  it('round-trips a fully populated state', () => {
    const state = { search: 'cors', category: 'Headers', state: 'disabled' as const };
    expect(parsePluginFilters(params(serializePluginFilters(state)))).toEqual(state);
  });
});

describe('pluginsHref', () => {
  it('builds the links the summary cards use', () => {
    expect(pluginsHref()).toBe('/plugins');
    expect(pluginsHref({ state: 'enabled' })).toBe('/plugins?state=enabled');
    expect(pluginsHref({ state: 'disabled' })).toBe('/plugins?state=disabled');
  });

  it('produces a state the page parses back unchanged', () => {
    const href = pluginsHref({ state: 'disabled' });
    const filters = parsePluginFilters(params(href.split('?')[1] ?? ''));

    expect(filters.state).toBe('disabled');
    expect(hasActivePluginFilters(filters)).toBe(true);
  });
});

describe('filterPlugins', () => {
  it('returns everything when no filter is applied', () => {
    expect(filterPlugins(CHECKS, EMPTY_PLUGIN_FILTERS)).toHaveLength(3);
  });

  it('matches the counts the cards show', () => {
    const enabled = filterPlugins(CHECKS, { ...EMPTY_PLUGIN_FILTERS, state: 'enabled' });
    const disabled = filterPlugins(CHECKS, { ...EMPTY_PLUGIN_FILTERS, state: 'disabled' });

    expect(enabled.map((p) => p.id)).toEqual(['jwt', 'hsts']);
    expect(disabled.map((p) => p.id)).toEqual(['cors']);
    expect(enabled.length + disabled.length).toBe(CHECKS.length);
  });

  it('combines category and availability', () => {
    const result = filterPlugins(CHECKS, {
      ...EMPTY_PLUGIN_FILTERS,
      category: 'Headers',
      state: 'enabled',
    });
    expect(result.map((p) => p.id)).toEqual(['hsts']);
  });

  it('searches name, description and tags case-insensitively', () => {
    expect(filterPlugins(CHECKS, { ...EMPTY_PLUGIN_FILTERS, search: 'JWT' })).toHaveLength(1);
    expect(filterPlugins(CHECKS, { ...EMPTY_PLUGIN_FILTERS, search: 'cors' })).toHaveLength(1);
    expect(filterPlugins(CHECKS, { ...EMPTY_PLUGIN_FILTERS, search: 'security check' })).toHaveLength(3);
  });
});

describe('getPluginCategories', () => {
  it('lists each category once, sorted, without the sentinel', () => {
    const categories = getPluginCategories(CHECKS);
    expect(categories).toEqual(['Authentication', 'Headers']);
    expect(categories).not.toContain(ALL_CATEGORIES);
  });
});
