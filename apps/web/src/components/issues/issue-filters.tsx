'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types';
import { ANY, ISSUE_STATUS_LABELS, type IssueFilterState } from '@/lib/issue-list';
import { useDebouncedField } from '@/hooks/use-debounced-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SEVERITY_META, SEVERITY_ORDER } from '@/components/security/severity-badge';
import { STATUS_META } from '@/components/security/finding-status-badge';

/** Same control metrics as the Scans filter row, so the two pages line up. */
const CONTROL_CLASS = 'h-9 border-border/70 bg-card shadow-none';
const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

/*
 * The filter state itself lives in `@/lib/issue-list`, next to the URL
 * parse/serialize helpers, so the summary cards can build a link to a filtered
 * view without importing this component.
 */

type FilterOption = { value: string; label: string; dot: string };

const SEVERITY_OPTIONS: FilterOption[] = [
  { value: ANY, label: 'All severities', dot: 'bg-muted-foreground' },
  ...SEVERITY_ORDER.map((severity) => ({
    value: severity,
    label: SEVERITY_META[severity].label,
    dot: SEVERITY_META[severity].dot,
  })),
];

const STATUS_OPTIONS: FilterOption[] = [
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
          className={CONTROL_CLASS}
        />
      </FilterField>

      <SelectFilter
        label="Severity"
        id="issue-filter-severity"
        options={SEVERITY_OPTIONS}
        value={value.severity}
        onChange={(next) => onChange({ ...value, severity: next })}
      />

      <SelectFilter
        label="Status"
        id="issue-filter-status"
        options={STATUS_OPTIONS}
        value={value.status}
        onChange={(next) => onChange({ ...value, status: next })}
      />
    </div>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className={LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function SelectFilter({
  label,
  id,
  options,
  value,
  onChange,
}: {
  label: string;
  id: string;
  options: FilterOption[];
  value: string;
  onChange: (_next: string) => void;
}) {
  return (
    <FilterField label={label} htmlFor={id}>
      <Select value={value} onValueChange={onChange}>
        {/* The trigger mirrors the selected item's content, so the dot it shows
            comes from the option below rather than a second lookup here. */}
        <SelectTrigger id={id} className={CONTROL_CLASS} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  <span className={cn('size-1.5 shrink-0 rounded-full', option.dot)} />
                  <span>{option.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </FilterField>
  );
}

