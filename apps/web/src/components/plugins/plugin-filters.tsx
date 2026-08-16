'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  ALL_CATEGORIES,
  PLUGIN_STATE_LABELS,
  PLUGIN_STATE_VALUES,
  type PluginFilterState,
} from '@/lib/plugin-list';
import { useDebouncedField } from '@/hooks/use-debounced-field';
import { Input } from '@/components/ui/input';
import {
  FilterField,
  FilterSelect,
  FILTER_CONTROL_CLASS,
  type FilterSelectOption,
} from '@/components/filters/filter-select';

/**
 * Search, availability and category on one row — the same three-control layout
 * as Issues and Scans, built from the same components.
 *
 * It replaced a search box with two wrapping strips of toggle chips below it:
 * one per availability state, one per category. The chips grew a row every time
 * a category was added and pushed the list itself off the screen, and nothing
 * about them said the two strips combined rather than each replacing the other.
 */

/** Availability carries a state colour, so it gets dots like severity does. */
const STATE_DOTS: Record<(typeof PLUGIN_STATE_VALUES)[number], string> = {
  all: 'bg-muted-foreground',
  enabled: 'bg-success',
  disabled: 'bg-destructive',
};

const STATE_OPTIONS: FilterSelectOption[] = PLUGIN_STATE_VALUES.map((state) => ({
  value: state,
  label: state === 'all' ? 'All checks' : PLUGIN_STATE_LABELS[state],
  dot: STATE_DOTS[state],
}));

export type PluginFiltersProps = {
  value: PluginFilterState;
  onChange: (_next: PluginFilterState) => void;
  /** Categories present in the loaded checks, without the `all` sentinel. */
  categories: string[];
  className?: string;
};

export function PluginFilters({ value, onChange, categories, className }: PluginFiltersProps) {
  const search = useDebouncedField(value.search, (next) => onChange({ ...value, search: next }));

  const categoryOptions = useMemo<FilterSelectOption[]>(() => {
    // A category is a plain value, not a state, so no dots here.
    const known = new Set(categories);
    return [
      { value: ALL_CATEGORIES, label: 'All categories' },
      ...categories.map((category) => ({ value: category, label: category })),
      // The filter comes from the URL and the categories come from the API, so
      // on the first render — and on any link to a category no check declares —
      // the applied value can be missing from the list. Without this the select
      // renders blank while claiming to filter by something.
      ...(value.category !== ALL_CATEGORIES && !known.has(value.category)
        ? [{ value: value.category, label: value.category }]
        : []),
    ];
  }, [categories, value.category]);

  return (
    <div
      className={cn(
        // Same breakpoints as the Issues row: stacked, then search over the two
        // selects, then one row with the search taking the slack.
        'grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(240px,1fr)_11rem_13rem]',
        className,
      )}
    >
      <FilterField label="Search" htmlFor="plugin-filter-search">
        <Input
          id="plugin-filter-search"
          value={search.draft}
          onChange={(event) => search.setDraft(event.target.value)}
          placeholder="Search checks…"
          className={FILTER_CONTROL_CLASS}
        />
      </FilterField>

      <FilterSelect
        label="Availability"
        id="plugin-filter-state"
        options={STATE_OPTIONS}
        value={value.state}
        onChange={(next) => onChange({ ...value, state: next as PluginFilterState['state'] })}
      />

      <FilterSelect
        label="Category"
        id="plugin-filter-category"
        options={categoryOptions}
        value={value.category}
        onChange={(next) => onChange({ ...value, category: next })}
      />
    </div>
  );
}
