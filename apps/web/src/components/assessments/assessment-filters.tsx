'use client';

import * as React from 'react';
import {
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns';
import { CalendarDays, ChevronDown } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { cn, formatDuration } from '@/lib/utils';
import {
  ASSESSMENT_STATUS_LABELS,
  buildAssessmentChips,
  describeDateRange,
  EMPTY_ASSESSMENT_FILTERS,
  fromDayString,
  toDayString,
  toggleFilterValue,
  type AssessmentFilterState,
} from '@/lib/assessment-list';
import type { AssessmentStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { FilterChips } from '@/components/filters/filter-chips';
import { FILTER_SURFACE_CLASS } from '@/components/filters/filter-popover';
import { useDebouncedField } from '@/hooks/use-debounced-field';

const STATUS_OPTIONS = Object.keys(ASSESSMENT_STATUS_LABELS) as AssessmentStatus[];

const CONTROL_CLASS = 'h-9 border-border/70 bg-card shadow-none';
const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

type SectionProps = {
  value: AssessmentFilterState;
  onChange: (_next: AssessmentFilterState) => void;
};

export type AssessmentFiltersProps = SectionProps & {
  /** Upper bound for the duration slider, derived from the loaded data. */
  durationBound: number;
  className?: string;
};

/**
 * Every filter is its own labelled control in the row: what is applied stays
 * readable without opening anything, and each one resets independently.
 */
export function AssessmentFilters({ value, onChange, durationBound, className }: AssessmentFiltersProps) {
  const search = useDebouncedField(value.search, (next) => onChange({ ...value, search: next }));

  const chips = buildAssessmentChips(value).map((chip) => ({
    id: chip.id,
    label: chip.label,
    onRemove: () => onChange(chip.next),
  }));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1.5 sm:w-72">
          <Label htmlFor="assessment-filter-search" className={LABEL_CLASS}>
            Project or URL
          </Label>
          <Input
            id="assessment-filter-search"
            value={search.draft}
            onChange={(event) => search.setDraft(event.target.value)}
            placeholder="Filter by project or URL"
            className={CONTROL_CLASS}
          />
        </div>

        <StatusFilter value={value} onChange={onChange} />
        <DurationFilter value={value} onChange={onChange} durationBound={durationBound} />
        <DateFilter value={value} onChange={onChange} />
      </div>

      <FilterChips chips={chips} onClear={() => onChange(EMPTY_ASSESSMENT_FILTERS)} clearLabel="Clear" />
    </div>
  );
}

function FilterField({
  label,
  id,
  width,
  children,
}: {
  label: string;
  id: string;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('w-full space-y-1.5', width)}>
      <Label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function FilterTrigger({
  id,
  summary,
  isActive,
  icon,
}: {
  id: string;
  summary: string;
  isActive: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Button
      id={id}
      variant="outline"
      className={cn(CONTROL_CLASS, 'w-full justify-between gap-2 px-3 font-normal')}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className={cn('truncate', !isActive && 'text-muted-foreground')}>{summary}</span>
      </span>
      <ChevronDown className="size-4 shrink-0 opacity-50" />
    </Button>
  );
}

function StatusFilter({ value, onChange }: SectionProps) {
  const count = value.statuses.length;
  const summary =
    count === 0
      ? 'All statuses'
      : count === 1
        ? ASSESSMENT_STATUS_LABELS[value.statuses[0] as AssessmentStatus]
        : `${count} selected`;

  return (
    <FilterField label="Status" id="assessment-filter-status" width="sm:w-44">
      <Popover>
        <PopoverTrigger asChild>
          <div>
            <FilterTrigger id="assessment-filter-status" summary={summary} isActive={count > 0} />
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn(FILTER_SURFACE_CLASS, 'w-52 p-1.5')}>
          {STATUS_OPTIONS.map((status) => {
            const id = `assessment-status-${status}`;
            return (
              <label
                key={status}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <Checkbox
                  id={id}
                  checked={value.statuses.includes(status)}
                  onCheckedChange={() =>
                    onChange({ ...value, statuses: toggleFilterValue(value.statuses, status) })
                  }
                  className="size-4"
                />
                {ASSESSMENT_STATUS_LABELS[status]}
              </label>
            );
          })}
          {count > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
                onClick={() => onChange({ ...value, statuses: [] })}
              >
                Clear status
              </Button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </FilterField>
  );
}

function DurationFilter({ value, onChange, durationBound }: SectionProps & { durationBound: number }) {
  const isActive = value.durationMin !== null || value.durationMax !== null;
  const committed = React.useMemo<[number, number]>(
    () => [value.durationMin ?? 0, value.durationMax ?? durationBound],
    [value.durationMin, value.durationMax, durationBound],
  );

  // Dragging stays local; writing every intermediate value to the URL made the
  // router re-render mid-drag and the thumb fought the incoming state.
  const [draft, setDraft] = React.useState<[number, number]>(committed);
  React.useEffect(() => setDraft(committed), [committed]);

  function commit([min, max]: number[]) {
    const low = min ?? 0;
    const high = max ?? durationBound;
    // Spanning the whole range means "any", so clear instead of pinning bounds.
    const isFullRange = low === 0 && high === durationBound;
    onChange({
      ...value,
      durationMin: isFullRange ? null : low,
      durationMax: isFullRange ? null : high,
    });
  }

  return (
    <FilterField label="Duration" id="assessment-filter-duration" width="sm:w-48">
      <Popover>
        <PopoverTrigger asChild>
          <div>
            <FilterTrigger
              id="assessment-filter-duration"
              summary={
                isActive ? `${formatDuration(committed[0])} – ${formatDuration(committed[1])}` : 'Any duration'
              }
              isActive={isActive}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn(FILTER_SURFACE_CLASS, 'w-64 p-3')}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Duration</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDuration(draft[0])} – {formatDuration(draft[1])}
            </span>
          </div>
          <Slider
            value={draft}
            min={0}
            max={durationBound}
            step={5}
            aria-label="Duration range in seconds"
            onValueChange={(next) => setDraft([next[0] ?? 0, next[1] ?? durationBound])}
            onValueCommit={commit}
          />
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>0s</span>
            <span>{formatDuration(durationBound)}</span>
          </div>
          {isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
              onClick={() => onChange({ ...value, durationMin: null, durationMax: null })}
            >
              Clear duration
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </FilterField>
  );
}

function DateFilter({ value, onChange }: SectionProps) {
  const today = React.useMemo(() => new Date(), []);
  const presets = React.useMemo(
    () => [
      { label: 'Today', from: today, to: today },
      { label: 'Yesterday', from: subDays(today, 1), to: subDays(today, 1) },
      { label: 'Last 7 days', from: subDays(today, 6), to: today },
      { label: 'Last 30 days', from: subDays(today, 29), to: today },
      { label: 'Month to date', from: startOfMonth(today), to: today },
      {
        label: 'Last month',
        from: startOfMonth(subMonths(today, 1)),
        to: endOfMonth(subMonths(today, 1)),
      },
      { label: 'Year to date', from: startOfYear(today), to: today },
      {
        label: 'Last year',
        from: startOfYear(subYears(today, 1)),
        to: endOfYear(subYears(today, 1)),
      },
    ],
    [today],
  );

  const [month, setMonth] = React.useState(() => fromDayString(value.to) ?? today);
  const selected: DateRange | undefined =
    value.from || value.to
      ? { from: fromDayString(value.from), to: fromDayString(value.to) }
      : undefined;
  const summary = describeDateRange(value.from, value.to);

  function applyRange(from: Date | undefined, to: Date | undefined) {
    onChange({
      ...value,
      from: from ? toDayString(from) : null,
      to: to ? toDayString(to) : null,
    });
  }

  return (
    <FilterField label="Started" id="assessment-filter-date" width="sm:w-56">
      <Popover>
        <PopoverTrigger asChild>
          <div>
            <FilterTrigger
              id="assessment-filter-date"
              summary={summary ?? 'Any date'}
              isActive={Boolean(summary)}
              icon={<CalendarDays className="size-4 shrink-0 opacity-60" />}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn(FILTER_SURFACE_CLASS, 'w-auto p-0')}>
          <div className="flex max-sm:flex-col">
            <div className="flex shrink-0 flex-col gap-0.5 p-2 max-sm:order-1 max-sm:border-t max-sm:border-border sm:w-32 sm:border-r sm:border-border">
              <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-1">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full justify-start px-2 text-xs font-normal"
                    onClick={() => {
                      applyRange(preset.from, preset.to);
                      setMonth(preset.to);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              {summary && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
                  onClick={() => applyRange(undefined, undefined)}
                >
                  Clear dates
                </Button>
              )}
            </div>
            <Calendar
              mode="range"
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              disabled={[{ after: today }]}
              onSelect={(next) => applyRange(next?.from, next?.to)}
              className="p-3"
            />
          </div>
        </PopoverContent>
      </Popover>
    </FilterField>
  );
}

