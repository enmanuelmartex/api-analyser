'use client';

import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types';
import { ANY, ISSUE_STATUS_LABELS, type IssueFilterState } from '@/lib/issue-list';
import { useDebouncedField } from '@/hooks/use-debounced-field';
import { Input } from '@/components/ui/input';
import {
  FilterField,
  FilterSelect,
  FILTER_CONTROL_CLASS,
  type FilterSelectOption,
} from '@/components/filters/filter-select';
import { SEVERITY_META, SEVERITY_ORDER } from '@/components/security/severity-badge';
import { STATUS_META } from '@/components/security/finding-status-badge';

/*
 * The filter state itself lives in `@/lib/issue-list`, next to the URL
 * parse/serialize helpers, so the summary cards can build a link to a filtered
 * view without importing this component. The controls come from
 * `@/components/filters/filter-select`, shared with Security Checks.
 */

const SEVERITY_OPTIONS: FilterSelectOption[] = [
  { value: ANY, label: 'All severities', dot: 'bg-muted-foreground' },
  ...SEVERITY_ORDER.map((severity) => ({
    value: severity,
    label: SEVERITY_META[severity].label,
    dot: SEVERITY_META[severity].dot,
  })),
];

const STATUS_OPTIONS: FilterSelectOption[] = [
  { value: ANY, label: 'All statuses', dot: 'bg-muted-foreground' },
  ...(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((status) => ({
    value: status,
    label: ISSUE_STATUS_LABELS[status],
    dot: STATUS_META[status]?.dot ?? 'bg-muted-foreground',
  })),
];

export type IssueFiltersProps = {
  value: IssueFilterState;
  onChange: (_next: IssueFilterState) => void;
  className?: string;
};

/**
 * Search, severity and status as three labelled controls on one row. The two
 * dropdowns replaced a strip of eleven toggle buttons: the applied filter is
 * still readable at a glance, but the row no longer grows with the enums.
 */
export function IssueFilters({ value, onChange, className }: IssueFiltersProps) {
  const search = useDebouncedField(value.search, (next) => onChange({ ...value, search: next }));

  return (
    <div
      className={cn(
        // Stacked on mobile, search over the two selects on tablet, one row on
        // desktop — search takes the slack, the selects keep a fixed width.
        'grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(240px,1fr)_11rem_13rem]',
        className,
      )}
    >
      <FilterField label="Search" htmlFor="issue-filter-search">
        <Input
          id="issue-filter-search"
          value={search.draft}
          onChange={(event) => search.setDraft(event.target.value)}
          placeholder="Search issues…"
          className={FILTER_CONTROL_CLASS}
        />
      </FilterField>

      <FilterSelect
        label="Severity"
        id="issue-filter-severity"
        options={SEVERITY_OPTIONS}
        value={value.severity}
        onChange={(next) => onChange({ ...value, severity: next })}
      />

      <FilterSelect
        label="Status"
        id="issue-filter-status"
        options={STATUS_OPTIONS}
        value={value.status}
        onChange={(next) => onChange({ ...value, status: next })}
      />
    </div>
  );
}
