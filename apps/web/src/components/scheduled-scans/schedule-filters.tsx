'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import type { Project } from '@/types';
import {
  ANY,
  FILTERABLE_STATUSES,
  FREQUENCY_LABELS,
  FREQUENCY_ORDER,
  SCHEDULE_STATUS_META,
  type ScheduleFilterState,
} from '@/lib/schedule-list';
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
import { cn } from '@/lib/utils';

/** The same control metrics the Issues and Scans filter rows use. */
const CONTROL_CLASS = 'h-9 border-border/70 bg-card shadow-none';
const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

/**
 * Search, status, frequency and project as one labelled row.
 *
 * Every filter is applied server-side — the state lives in the URL and is
 * passed to the API — so the counts under the table describe the whole result
 * set rather than the page that happens to be loaded.
 */
export function ScheduleFilters({
  value,
  onChange,
  hideProject = false,
  className,
}: {
  value: ScheduleFilterState;
  onChange: (_next: ScheduleFilterState) => void;
  /** Hidden when the surrounding screen is already scoped to one project. */
  hideProject?: boolean;
  className?: string;
}) {
  const search = useDebouncedField(value.search, (next) => onChange({ ...value, search: next }));

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    enabled: !hideProject,
  });

  return (
    <div
      className={cn(
        'grid gap-3 sm:grid-cols-2',
        hideProject
          ? 'md:grid-cols-[minmax(240px,1fr)_11rem_11rem]'
          : 'md:grid-cols-[minmax(220px,1fr)_10rem_10rem_12rem]',
        className,
      )}
    >
      <FilterField label="Search" htmlFor="schedule-filter-search">
        <Input
          id="schedule-filter-search"
          value={search.draft}
          onChange={(event) => search.setDraft(event.target.value)}
          placeholder="Schedule or project…"
          className={CONTROL_CLASS}
        />
      </FilterField>

      <FilterField label="Status" htmlFor="schedule-filter-status">
        <Select
          value={value.status}
          onValueChange={(next) => onChange({ ...value, status: next })}
        >
          <SelectTrigger id="schedule-filter-status" className={CONTROL_CLASS} aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectItem value={ANY}>
                <span className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                  All statuses
                </span>
              </SelectItem>
              {FILTERABLE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', SCHEDULE_STATUS_META[status].dot)}
                    />
                    {SCHEDULE_STATUS_META[status].label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Frequency" htmlFor="schedule-filter-frequency">
        <Select
          value={value.frequency}
          onValueChange={(next) => onChange({ ...value, frequency: next })}
        >
          <SelectTrigger
            id="schedule-filter-frequency"
            className={CONTROL_CLASS}
            aria-label="Frequency"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectItem value={ANY}>All frequencies</SelectItem>
              {FREQUENCY_ORDER.map((frequency) => (
                <SelectItem key={frequency} value={frequency}>
                  {FREQUENCY_LABELS[frequency]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>

      {!hideProject && (
        <FilterField label="Project" htmlFor="schedule-filter-project">
          <Select
            value={value.projectId}
            onValueChange={(next) => onChange({ ...value, projectId: next })}
          >
            <SelectTrigger
              id="schedule-filter-project"
              className={CONTROL_CLASS}
              aria-label="Project"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value={ANY}>All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FilterField>
      )}
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
