'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { IconDownload, IconLoader2 } from '@tabler/icons-react';
import { logsApi, type LogQueryParams } from '@/lib/api';
import type { AuditLog } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Exporting the audit trail.
 *
 * There is no export endpoint, and adding one would mean a second query path to
 * keep in step with the filters the table already applies. Instead this pages
 * the existing list endpoint at its maximum page size and assembles the file in
 * the browser, which guarantees the export contains exactly the rows the table
 * is showing — the alternative is a "download" that quietly disagrees with the
 * screen it sits under.
 *
 * The ceiling is real and is stated in the UI rather than discovered when a
 * spreadsheet turns out to be truncated. Anyone who needs the whole table of
 * half a million rows should be reading the database, not a CSV.
 */
const PAGE_SIZE = 200; // The API's hard maximum (`QueryLogsDto`).
const MAX_ROWS = 10_000;

interface CsvColumn {
  header: string;
  // eslint-disable-next-line no-unused-vars
  value: (log: AuditLog) => string | number | null | undefined;
}

/** Columns written to the CSV, in order. Flat scalars only — a cell is not JSON. */
const CSV_COLUMNS: CsvColumn[] = [
  { header: 'timestamp', value: (log) => log.createdAt },
  { header: 'severity', value: (log) => log.severity },
  { header: 'status', value: (log) => log.status },
  { header: 'category', value: (log) => log.category },
  { header: 'event', value: (log) => log.event },
  { header: 'message', value: (log) => log.message },
  { header: 'resource', value: (log) => log.resource },
  { header: 'resource_id', value: (log) => log.resourceId },
  { header: 'user_name', value: (log) => log.user?.name },
  { header: 'user_email', value: (log) => log.user?.email },
  { header: 'user_id', value: (log) => log.userId },
  { header: 'source', value: (log) => log.source },
  { header: 'ip_address', value: (log) => log.ipAddress },
  { header: 'http_method', value: (log) => log.httpMethod },
  { header: 'route', value: (log) => log.route },
  { header: 'status_code', value: (log) => log.statusCode },
  { header: 'duration_ms', value: (log) => log.durationMs },
  { header: 'request_id', value: (log) => log.requestId },
  { header: 'error_code', value: (log) => log.errorCode },
  { header: 'id', value: (log) => log.id },
];

export function LogExportButton({
  filters,
  /** Describes what will be written, shown above the two formats. */
  scopeLabel,
  variant = 'outline',
  label = 'Export',
  disabled,
}: {
  filters: LogQueryParams;
  scopeLabel: string;
  variant?: 'outline' | 'ghost';
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);

  async function run(format: 'csv' | 'json') {
    setBusy(true);
    const toastId = toast.loading('Preparing export…');

    try {
      const rows: AuditLog[] = [];
      let total = 0;

      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const page = await logsApi.list({
          ...filters,
          limit: PAGE_SIZE,
          offset,
          sortBy: 'createdAt',
          sortDir: 'desc',
        });

        total = page.total;
        rows.push(...page.items);

        toast.loading(`Collected ${rows.length.toLocaleString()} of ${Math.min(total, MAX_ROWS).toLocaleString()} events…`, {
          id: toastId,
        });

        if (page.items.length < PAGE_SIZE || rows.length >= total) break;
      }

      if (rows.length === 0) {
        toast.error('Nothing to export', {
          id: toastId,
          description: 'No event matches the current filters.',
        });
        return;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      download(
        format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2),
        `audit-logs-${stamp}.${format}`,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
      );

      const truncated = total > rows.length;
      toast.success(`Exported ${rows.length.toLocaleString()} events`, {
        id: toastId,
        description: truncated
          ? `The filter matches ${total.toLocaleString()} events; the export is capped at ${MAX_ROWS.toLocaleString()}. Narrow the date range to capture the rest.`
          : undefined,
      });
    } catch (err: any) {
      toast.error('Export failed', {
        id: toastId,
        description: err?.response?.data?.message ?? 'The API did not return the events.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled || busy}
        >
          {busy ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconDownload className="h-3.5 w-3.5" />
          )}
          {busy ? 'Exporting…' : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {scopeLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run('csv')} className="text-xs">
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('json')} className="text-xs">
          Export JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Up to {MAX_ROWS.toLocaleString()} events per export.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Serialising ──────────────────────────────────────────────────────────────

/**
 * RFC 4180 quoting.
 *
 * Every field is quoted rather than only the ones that need it: audit messages
 * routinely contain commas and quotes, and a conditional quoter is one edge
 * case away from producing a file that a spreadsheet silently misparses into
 * the wrong columns.
 */
function toCsv(rows: AuditLog[]): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    return `"${String(value).replace(/"/g, '""')}"`;
  };

  const lines = [
    CSV_COLUMNS.map((column) => escape(column.header)).join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => escape(column.value(row))).join(',')),
  ];

  // A BOM, so Excel opens UTF-8 as UTF-8 rather than as the system codepage —
  // without it, any non-ASCII character in a log message arrives mangled.
  return `﻿${lines.join('\r\n')}\r\n`;
}

function download(contents: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari, which has not necessarily read the blob when `click()` returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
