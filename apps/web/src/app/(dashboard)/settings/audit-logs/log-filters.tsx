'use client';

import * as React from 'react';
import {
  IconSearch,
  IconX,
  IconFilter,
  IconCalendar,
  IconChevronDown,
  IconCheck,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserSelect, toUserOption } from '@/components/shared/user-select';
import { LOG_CATEGORIES, LOG_SEVERITIES, LOG_STATUSES } from '@/types';
import type { LogCategory, LogSeverity, LogStatus, ManagedUser } from '@/types';
import { LogSeverityBadge } from '../_components/log-badges';

/** The complete filter state, owned by the parent and serialised into the query. */
export interface LogFilterState {
  search: string;
  severity: LogSeverity[];
  category: LogCategory[];
  status: LogStatus[];
  userId: string;
  event: string;
  range: RangePreset;
  /** Only meaningful when `range` is `custom`. */
  customFrom?: Date;
  customTo?: Date;
}

export type RangePreset = '1h' | '6h' | '24h' | '7d' | '30d' | 'all' | 'custom';

export const RANGE_LABELS: Record<RangePreset, string> = {
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
  custom: 'Custom range',
};

/** The presets offered in the picker, in order. `custom` is the calendar below them. */
const RANGE_PRESETS = ['1h', '6h', '24h', '7d', '30d', 'all'] as const;

export const EMPTY_FILTERS: LogFilterState = {
  search: '',
  severity: [],
  category: [],
  status: [],
  userId: '',
  event: '',
  range: '24h',
};

/**
 * Turns the preset into an absolute window.
 *
 * Computed at query time rather than when the preset is chosen, so "last hour"
 * keeps meaning the last hour on a screen left open — a window frozen at
 * selection time silently stops including new events.
 */
export function resolveRange(state: LogFilterState): { from?: string; to?: string } {
  const now = Date.now();
  const hours: Partial<Record<RangePreset, number>> = {
    '1h': 1,
    '6h': 6,
    '24h': 24,
    '7d': 168,
    '30d': 720,
  };

  if (state.range === 'all') return {};
  if (state.range === 'custom') {
    return {
      from: state.customFrom?.toISOString(),
      // Extended to the end of the chosen day: a user picking "12 Aug" means
      // the whole of the 12th, not midnight at its start.
      to: state.customTo ? endOfDay(state.customTo).toISOString() : undefined,
    };
  }

  const span = hours[state.range];
  return span ? { from: new Date(now - span * 60 * 60 * 1000).toISOString() } : {};
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function countActiveFilters(state: LogFilterState): number {
  return (
    (state.search ? 1 : 0) +
    state.severity.length +
    state.category.length +
    state.status.length +
    (state.userId ? 1 : 0) +
    (state.event ? 1 : 0) +
    (state.range !== '24h' ? 1 : 0)
  );
}

// ── Multi-select ─────────────────────────────────────────────────────────────

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  renderOption,
  width = 'w-[200px]',
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  // eslint-disable-next-line no-unused-vars
  onChange: (next: T[]) => void;
  // eslint-disable-next-line no-unused-vars
  renderOption?: (value: T) => React.ReactNode;
  width?: string;
}) {
  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 justify-between gap-1.5 text-xs font-normal', width)}
        >
          <span className="truncate">
            {label}
            {selected.length > 0 && (
              <span className="ml-1 text-muted-foreground">· {selected.length}</span>
            )}
          </span>
          <IconChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No match.
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const active = selected.includes(option);
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggle(option)}
                    className="gap-2 text-xs"
                  >
                    <div
                      className={cn(
                        'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {active && <IconCheck className="h-2.5 w-2.5" />}
                    </div>
                    {renderOption ? renderOption(option) : <span>{option}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.length > 0 && (
              <>
                <Separator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange([])}
                    className="justify-center text-xs text-muted-foreground"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Date range ───────────────────────────────────────────────────────────────

function RangePicker({
  state,
  onChange,
}: {
  state: LogFilterState;
  // eslint-disable-next-line no-unused-vars
  onChange: (patch: Partial<LogFilterState>) => void;
}) {
  const [open, setOpen] = React.useState(false);

  const label =
    state.range === 'custom' && state.customFrom
      ? `${state.customFrom.toLocaleDateString()} – ${state.customTo?.toLocaleDateString() ?? '…'}`
      : RANGE_LABELS[state.range];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-normal">
          <IconCalendar className="h-3.5 w-3.5 opacity-60" />
          <span className="truncate">{label}</span>
          <IconChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col p-1">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onChange({ range: preset, customFrom: undefined, customTo: undefined });
                setOpen(false);
              }}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                state.range === preset && 'bg-accent font-medium',
              )}
            >
              {RANGE_LABELS[preset]}
            </button>
          ))}
        </div>
        <Separator />
        <div className="p-2">
          <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Custom range
          </p>
          <Calendar
            mode="range"
            selected={
              state.customFrom ? { from: state.customFrom, to: state.customTo } : undefined
            }
            onSelect={(picked: { from?: Date; to?: Date } | undefined) =>
              onChange({
                range: 'custom',
                customFrom: picked?.from,
                customTo: picked?.to,
              })
            }
            numberOfMonths={1}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── The bar ──────────────────────────────────────────────────────────────────

/**
 * The filter bar.
 *
 * Inline on desktop; behind a single "Filters" sheet below `md`, because six
 * dropdowns wrapped onto four lines is unusable on a narrow screen and pushes
 * the table itself off the viewport.
 */
export function LogFilters({
  state,
  onChange,
  onReset,
  users,
  events,
  trailing,
  className,
}: {
  state: LogFilterState;
  // eslint-disable-next-line no-unused-vars
  onChange: (patch: Partial<LogFilterState>) => void;
  onReset: () => void;
  users: ManagedUser[];
  events: string[];
  /** Controls that act on the view rather than the query — the column picker. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const activeCount = countActiveFilters(state);

  /*
   * The email stays on a second line under each name: the audit log is read to
   * work out who did something, and two accounts sharing a display name are
   * exactly the case where that question matters.
   */
  const userOptions = React.useMemo(
    () => users.map((user) => ({ ...toUserOption(user), description: user.email })),
    [users],
  );

  const controls = (
    <>
      <MultiSelect
        label="Severity"
        options={LOG_SEVERITIES}
        selected={state.severity}
        onChange={(severity) => onChange({ severity })}
        renderOption={(value) => <LogSeverityBadge severity={value} />}
        width="w-[140px]"
      />
      <MultiSelect
        label="Category"
        options={LOG_CATEGORIES}
        selected={state.category}
        onChange={(category) => onChange({ category })}
        renderOption={(value) => <span className="font-mono">{value.toLowerCase()}</span>}
        width="w-[150px]"
      />
      <MultiSelect
        label="Status"
        options={LOG_STATUSES}
        selected={state.status}
        onChange={(status) => onChange({ status })}
        width="w-[125px]"
      />
      <EventPicker value={state.event} events={events} onChange={(event) => onChange({ event })} />
      {/*
        `userId` is '' when unfiltered, which is what the query layer already
        expects; `UserSelect` speaks `null`, so the two meet here rather than
        teaching either side about the other's empty value.
      */}
      <UserSelect
        ariaLabel="Filter by user"
        users={userOptions}
        value={state.userId || null}
        onValueChange={(userId) => onChange({ userId: userId ?? '' })}
        allowAll
        allLabel="All users"
        placeholder="All users"
        groupLabel="Select a user"
        emptyMessage="No users found."
        className="h-8 w-[180px] border-border text-xs font-normal [&>svg]:size-3.5 [&>svg]:opacity-50"
      />
      <RangePicker state={state} onChange={onChange} />
    </>
  );

  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border border-border bg-card p-3',
        className,
      )}
    >
      {/* Row one: the search box owns the full width. */}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search events, users, IPs, request IDs, endpoints…"
          className="h-8 pl-8 pr-8 text-xs"
          aria-label="Search logs"
        />
        {state.search && (
          <button
            type="button"
            onClick={() => onChange({ search: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Row two: the filters, wrapping cleanly rather than compressing. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Desktop: the controls inline. */}
        <div className="hidden flex-wrap items-center gap-2 md:flex">{controls}</div>

        {/* Narrow: one button, everything behind a sheet. */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs md:hidden">
              <IconFilter className="h-3.5 w-3.5" />
              Filters
              {activeCount > 0 && (
                <Badge variant="neutral" className="h-4 px-1 text-[10px]">
                  {activeCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-3 [&>*]:w-full [&_button]:w-full">{controls}</div>
          </SheetContent>
        </Sheet>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 gap-1 px-2 text-xs text-muted-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
            Reset
            <Badge variant="neutral" className="h-4 px-1 text-[10px]">
              {activeCount}
            </Badge>
          </Button>
        )}

        {/* Pushed right: acts on the table, not on the query. */}
        {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
      </div>
    </div>
  );
}

function EventPicker({
  value,
  events,
  onChange,
}: {
  value: string;
  events: string[];
  // eslint-disable-next-line no-unused-vars
  onChange: (event: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-[170px] justify-between gap-1.5 text-xs font-normal"
        >
          <span className={cn('truncate', value && 'font-mono')}>{value || 'Event'}</span>
          <IconChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Find an event…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No event recorded yet.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="text-xs text-muted-foreground"
              >
                Any event
              </CommandItem>
              {events.map((event) => (
                <CommandItem
                  key={event}
                  value={event}
                  onSelect={() => {
                    onChange(event);
                    setOpen(false);
                  }}
                  className="font-mono text-xs"
                >
                  {event}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
