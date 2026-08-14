import type { Plugin } from '@/types';

/**
 * Security Checks list filter state, expressed as URL search params.
 *
 * Search and category used to be component state, which meant the summary cards
 * above the list ("Enabled", "Disabled") had nothing they could drive. They now
 * follow the same shape as the Projects and Scans lists: parse from the URL,
 * serialize back to it, filter with one pure function that both the list and
 * its tests can call.
 */

/** Availability filter. `all` is the "no filter" sentinel, not a real state. */
export type PluginStateFilter = 'all' | 'enabled' | 'disabled';

/** Category sentinel, mirroring `PluginStateFilter['all']`. */
export const ALL_CATEGORIES = 'all';

export type PluginFilterState = {
  /** Matches the name, the description or a tag. */
  search: string;
  /** A `Plugin['category']` value, or `ALL_CATEGORIES`. */
  category: string;
  state: PluginStateFilter;
};

export const EMPTY_PLUGIN_FILTERS: PluginFilterState = {
  search: '',
  category: ALL_CATEGORIES,
  state: 'all',
};

export const PLUGIN_STATE_LABELS: Record<PluginStateFilter, string> = {
  all: 'All',
  enabled: 'Enabled',
  disabled: 'Disabled',
};

export const PLUGIN_STATE_VALUES = Object.keys(PLUGIN_STATE_LABELS) as PluginStateFilter[];

export function parsePluginFilters(params: URLSearchParams): PluginFilterState {
  const state = (params.get('state') ?? '').toLowerCase();

  return {
    search: params.get('q') ?? '',
    // Categories come from the checks themselves, so anything is accepted here
    // and simply matches nothing if no check declares it.
    category: params.get('category') || ALL_CATEGORIES,
    state: PLUGIN_STATE_VALUES.includes(state as PluginStateFilter)
      ? (state as PluginStateFilter)
      : 'all',
  };
}

export function serializePluginFilters(state: PluginFilterState): string {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.category !== ALL_CATEGORIES) params.set('category', state.category);
  if (state.state !== 'all') params.set('state', state.state);
  return params.toString();
}

export function hasActivePluginFilters(state: PluginFilterState): boolean {
  return Boolean(state.search.trim()) || state.category !== ALL_CATEGORIES || state.state !== 'all';
}

/** The link a summary card points at, built from the same serializer. */
export function pluginsHref(overrides: Partial<PluginFilterState> = {}): string {
  const query = serializePluginFilters({ ...EMPTY_PLUGIN_FILTERS, ...overrides });
  return query ? `/plugins?${query}` : '/plugins';
}

export function getPluginCategories(plugins: Plugin[]): string[] {
  return Array.from(new Set(plugins.map((plugin) => plugin.category))).sort();
}

export function filterPlugins(plugins: Plugin[], state: PluginFilterState): Plugin[] {
  const search = state.search.trim().toLocaleLowerCase();

  return plugins.filter((plugin) => {
    if (search) {
      const matches =
        plugin.name.toLocaleLowerCase().includes(search) ||
        plugin.description.toLocaleLowerCase().includes(search) ||
        plugin.tags.some((tag) => tag.toLocaleLowerCase().includes(search));
      if (!matches) return false;
    }
    if (state.category !== ALL_CATEGORIES && plugin.category !== state.category) return false;
    if (state.state === 'enabled' && !plugin.isEnabled) return false;
    if (state.state === 'disabled' && plugin.isEnabled) return false;
    return true;
  });
}
