'use client';

import * as React from 'react';
import type { VisibilityState } from '@tanstack/react-table';
import { IconLayoutColumns } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOG_COLUMNS } from './log-table';

/**
 * Which columns the log table renders.
 *
 * Lives beside the filters rather than inside the table because it is a view
 * preference, and because the parent persists it per browser: an operator who
 * always wants Request ID and never wants Endpoint should set that once.
 *
 * Event is not offerable. It is the column carrying the message, and a log
 * table with no event column is a list of timestamps.
 */
const LOCKED = new Set(['event']);

export function LogColumnPicker({
  visibility,
  onChange,
}: {
  visibility: VisibilityState;
  onChange: React.Dispatch<React.SetStateAction<VisibilityState>>;
}) {
  const isVisible = (id: string) => visibility[id] !== false;
  const hiddenCount = LOG_COLUMNS.filter((column) => !isVisible(column.id)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <IconLayoutColumns className="h-3.5 w-3.5" />
          Columns
          {hiddenCount > 0 && (
            <span className="text-muted-foreground">· {LOG_COLUMNS.length - hiddenCount}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOG_COLUMNS.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={isVisible(column.id)}
            disabled={LOCKED.has(column.id)}
            onCheckedChange={(value) =>
              onChange((current) => ({ ...current, [column.id]: Boolean(value) }))
            }
            // Radix closes the menu on select; toggling several columns should
            // not mean reopening it between each one.
            onSelect={(event) => event.preventDefault()}
            className="text-xs"
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        {hiddenCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onChange({})}
              className="justify-center text-xs text-muted-foreground"
            >
              Show all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
