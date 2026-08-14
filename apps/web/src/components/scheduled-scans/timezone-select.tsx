'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconCheck, IconSelector } from '@tabler/icons-react';
import { scheduledScansApi } from '@/lib/api';
import type { TimeZoneOption } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * A searchable timezone picker.
 *
 * A plain `<Select>` would be a four-hundred-item scroll, so this is a
 * combobox. The list comes from the API rather than a bundled constant for two
 * reasons: it is exactly the set the server will accept, and each entry carries
 * the offset that is in force RIGHT NOW — `America/Santo_Domingo (UTC-4)` — so
 * the operator confirms they picked the zone they meant without doing arithmetic.
 *
 * The offset is shown, never stored. Storing `UTC-4` instead of the zone name
 * is the bug this whole feature is designed to avoid: an offset cannot express
 * "02:00 local, before and after the clocks change".
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (_next: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const { data: zones = [], isLoading } = useQuery<TimeZoneOption[]>({
    queryKey: ['scheduled-scans', 'timezones'],
    queryFn: scheduledScansApi.timezones,
    // The tz database does not change during a session; the offsets it reports
    // do, but only twice a year.
    staleTime: 60 * 60_000,
  });

  const selected = zones.find((zone) => zone.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? (
              <>
                {selected.id.replace(/_/g, ' ')}{' '}
                <span className="text-muted-foreground">({selected.offset})</span>
              </>
            ) : (
              value || 'Select a timezone'
            )}
          </span>
          <IconSelector className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Loading timezones…' : 'No timezone found.'}</CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone.id}
                  // cmdk filters on `value`, so both halves of the label are
                  // searchable: "Santo" and "UTC-4" both find the right row.
                  value={`${zone.id} ${zone.offset}`}
                  onSelect={() => {
                    onChange(zone.id);
                    setOpen(false);
                  }}
                >
                  <IconCheck
                    className={cn('mr-2 size-4', zone.id === value ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="flex-1 truncate">{zone.id.replace(/_/g, ' ')}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{zone.offset}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The browser's own zone, used as the default for a new schedule. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
