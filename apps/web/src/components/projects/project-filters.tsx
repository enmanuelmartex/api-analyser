'use client';

import * as React from 'react';
import { ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildFilterChips,
  EMPTY_PROJECT_FILTERS,
  ENVIRONMENT_LABELS,
  environmentOptionLabel,
  SORT_LABELS,
  toggleFilterValue,
  type ProjectEnvironmentOption,
  type ProjectFilterState,
  type ProjectSortKey,
} from '@/lib/project-list';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FilterChips } from '@/components/filters/filter-chips';
import { FilterPopover, FILTER_SURFACE_CLASS } from '@/components/filters/filter-popover';
import { useDebouncedField } from '@/hooks/use-debounced-field';

const ENVIRONMENT_OPTIONS = Object.keys(ENVIRONMENT_LABELS) as ProjectEnvironmentOption[];
const SORT_OPTIONS = Object.keys(SORT_LABELS) as ProjectSortKey[];

/** Fields sit directly on the page background, so they carry the lifted surface. */
const CONTROL_CLASS = 'h-9 border-border/70 bg-card shadow-none';
const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

export type ProjectFiltersProps = {
  value: ProjectFilterState;
  onChange: (_next: ProjectFilterState) => void;
  /** Adds the "Draft o incompleto" option only when such projects exist. */
  hasDrafts?: boolean;
  className?: string;
};

export function ProjectFilters({ value, onChange, hasDrafts = false, className }: ProjectFiltersProps) {
  const name = useDebouncedField(value.name, (next) => onChange({ ...value, name: next }));
  const search = useDebouncedField(value.search, (next) => onChange({ ...value, search: next }));

  const environmentOptions = hasDrafts
    ? [...ENVIRONMENT_OPTIONS, 'DRAFT' as ProjectEnvironmentOption]
    : ENVIRONMENT_OPTIONS;
  const chips = buildFilterChips(value).map((chip) => ({
    id: chip.id,
    label: chip.label,
    onRemove: () => onChange(chip.next),
  }));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="project-filter-name" className={LABEL_CLASS}>
            Nombre
          </Label>
          <Input
            id="project-filter-name"
            value={name.draft}
            onChange={(event) => name.setDraft(event.target.value)}
            placeholder="Filtrar por nombre"
            className={CONTROL_CLASS}
          />
        </div>

        <div className="w-full space-y-1.5 sm:w-72">
          <Label htmlFor="project-filter-search" className={LABEL_CLASS}>
            URL o descripción
          </Label>
          <Input
            id="project-filter-search"
            value={search.draft}
            onChange={(event) => search.setDraft(event.target.value)}
            placeholder="Filter by URL or description"
            className={CONTROL_CLASS}
          />
        </div>

        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-2">
            <FilterPopover
              activeCount={value.environments.length}
              label="Entorno"
              contentClassName="w-56 p-0"
            >
              <Command>
                <CommandList className="max-h-none">
                  <CommandGroup heading="Entorno">
                    {environmentOptions.map((option) => {
                      const label = environmentOptionLabel(option);
                      return (
                        <CommandItem
                          key={option}
                          value={label}
                          onSelect={() =>
                            onChange({ ...value, environments: toggleFilterValue(value.environments, option) })
                          }
                          className="gap-2 text-sm"
                        >
                          <Checkbox
                            checked={value.environments.includes(option)}
                            tabIndex={-1}
                            className="pointer-events-none size-4"
                          />
                          {label}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </FilterPopover>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 shadow-none"
                      aria-label={`Ordenar proyectos (${SORT_LABELS[value.sort]})`}
                    >
                      <ArrowUpDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Ordenar: {SORT_LABELS[value.sort]}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className={cn('w-44', FILTER_SURFACE_CLASS)}>
                <DropdownMenuLabel className={LABEL_CLASS}>Ordenar por</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={value.sort}
                  onValueChange={(sort) => onChange({ ...value, sort: sort as ProjectSortKey })}
                >
                  {SORT_OPTIONS.map((sort) => (
                    <DropdownMenuRadioItem key={sort} value={sort} className="text-sm">
                      {SORT_LABELS[sort]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      </div>

      <FilterChips chips={chips} onClear={() => onChange(EMPTY_PROJECT_FILTERS)} />
    </div>
  );
}

