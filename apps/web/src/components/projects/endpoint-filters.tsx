'use client';

import * as React from 'react';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MethodBadge } from '@/components/security/method-badge';

/**
 * The two filters over an endpoint list.
 *
 * Both are driven entirely by what is in the imported specification — the
 * method list is the set of methods actually present, the tag list is the set of
 * tags actually used. Nothing here carries a hardcoded vocabulary, because a
 * filter offering `PATCH` on an API that has no PATCH operation is a dead
 * control, and one that omits a tag the spec uses hides endpoints.
 */

export const ALL_TAGS = '__all__';

/**
 * Method — multi-select.
 *
 * Methods combine the way an operator thinks about them ("show me everything
 * that writes": POST, PUT, PATCH, DELETE), which a single-select cannot express.
 * The trigger reports `selected/total` so the state is legible while closed,
 * and the row colours are the product's existing method palette rather than a
 * second one invented here.
 */
export function MethodMultiSelect({
  methods,
  selected,
  onChange,
  className,
}: {
  /** Methods present in this specification, in display order. */
  methods: string[];
  selected: string[];
  // eslint-disable-next-line no-unused-vars
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const toggle = (method: string) =>
    onChange(
      selected.includes(method)
        ? selected.filter((entry) => entry !== method)
        : [...selected, method],
    );

  // An empty selection means "all", so the count reads as the whole set rather
  // than as zero — which would suggest nothing is shown.
  const active = selected.length === 0 ? methods.length : selected.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn('h-9 justify-between gap-2 px-3 font-normal', className)}
        >
          <span className="flex items-center gap-1.5 text-sm">
            Method
            <span className="tabular-nums text-xs text-muted-foreground">
              {active}/{methods.length}
            </span>
          </span>
          <IconChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-56 p-1">
        <div role="listbox" aria-multiselectable="true" aria-label="Filter by method">
          {methods.map((method) => {
            const checked = selected.includes(method);
            return (
              <button
                key={method}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(method)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {checked && <IconCheck className="size-3.5 text-primary" />}
                </span>
                <MethodBadge method={method} />
              </button>
            );
          })}
        </div>

        {selected.length > 0 && (
          <>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => onChange([])}
            >
              All methods
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tags — single select.
 *
 * Single rather than multi because tags in an OpenAPI document are a grouping,
 * not a set of flags: an operator picks the area of the API they are looking at.
 * `ALL_TAGS` is a real option rather than a cleared state, so there is always a
 * visible way back to the unfiltered list.
 */
export function TagSelect({
  tags,
  value,
  onChange,
  className,
}: {
  tags: string[];
  value: string;
  // eslint-disable-next-line no-unused-vars
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-auto min-w-[8.5rem] gap-2', className)} aria-label="Filter by tag">
        {/*
          One inline span with a literal space, not a flex row with a gap.
          SelectTrigger applies `[&>span]:line-clamp-1`, which sets
          `display: -webkit-box` on its direct span child — that silently drops
          any flex layout declared here, and the label ran into the value as
          "TagsAll".
        */}
        <span className="truncate text-sm">
          <span className="text-muted-foreground">Tags</span>{' '}
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ALL_TAGS}>All</SelectItem>
        {tags.map((tag) => (
          <SelectItem key={tag} value={tag}>
            {tag}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Removable summary of what is currently filtering the list. */
export function ActiveFilterChips({
  methods,
  tag,
  onClearMethod,
  onClearTag,
}: {
  methods: string[];
  tag: string;
  // eslint-disable-next-line no-unused-vars
  onClearMethod: (method: string) => void;
  onClearTag: () => void;
}) {
  if (methods.length === 0 && tag === ALL_TAGS) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {methods.map((method) => (
        <Chip key={method} onRemove={() => onClearMethod(method)}>
          {method}
        </Chip>
      ))}
      {tag !== ALL_TAGS && <Chip onRemove={onClearTag}>{tag}</Chip>}
    </div>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <Badge variant="outline" className="h-6 gap-1 pl-2 pr-1 font-normal">
      <span className="text-[11px]">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${String(children)} filter`}
        className="rounded-sm px-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        ×
      </button>
    </Badge>
  );
}
