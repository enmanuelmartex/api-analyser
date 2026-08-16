'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The labelled controls every list page filters with.
 *
 * Extracted from the Issues filter row so Security Checks could use the same
 * one rather than grow a second look. Two pages rendering the same row from the
 * same component is the only way the metrics stay identical — the control
 * height and border below used to be copied into each file, and copies drift.
 */

/** Same control metrics as the Scans filter row, so every list page lines up. */
export const FILTER_CONTROL_CLASS = 'h-9 border-border/70 bg-card shadow-none';
export const FILTER_LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

export type FilterSelectOption = {
  value: string;
  label: string;
  /**
   * Background-colour class for the swatch beside the label.
   *
   * Optional, and deliberately so: a dot is a claim that the value has a state
   * colour, which severity and enablement have and a category does not. Painting
   * one anyway would invent a meaning the reader then has to decode.
   */
  dot?: string;
};

export function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className={FILTER_LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function FilterSelect({
  label,
  id,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  id: string;
  options: FilterSelectOption[];
  value: string;
  onChange: (_next: string) => void;
  className?: string;
}) {
  return (
    <FilterField label={label} htmlFor={id} className={className}>
      <Select value={value} onValueChange={onChange}>
        {/* The trigger mirrors the selected item's content, so the dot it shows
            comes from the option below rather than a second lookup here. */}
        <SelectTrigger id={id} className={FILTER_CONTROL_CLASS} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  {option.dot && (
                    <span className={cn('size-1.5 shrink-0 rounded-full', option.dot)} />
                  )}
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
