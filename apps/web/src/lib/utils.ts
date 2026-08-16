import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Severity } from '@/types';
import {
  formatDateTime,
  formatRelative as formatRelativeInterval,
} from './user-preferences';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function severityToBg(severity: Severity) {
  const styles: Record<Severity, string> = {
    /*
     * The `--severity-*` tokens, not the raw Tailwind palette.
     *
     * These were `red-500` / `orange-500` / `amber-500` with per-theme text
     * overrides, which meant severity had two definitions — this one and the
     * tokens in `globals.css` that the charts, the report and half the badges
     * already read. A severity that is one red in a table and a different red
     * in the donut beside it is a bug in a security product.
     */
    CRITICAL: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical',
    HIGH: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
    MEDIUM: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
    LOW: 'border-severity-low/30 bg-severity-low/10 text-severity-low',
    INFO: 'border-severity-info/30 bg-severity-info/10 text-severity-info',
  };
  return styles[severity];
}

/*
 * Both of these used to hold a hardcoded `en-US` formatter and the browser's
 * own timezone, which is what made Settings → General describe the region as a
 * fact rather than offer it as a choice. They are now thin wrappers over
 * `lib/user-preferences`, so the fifteen-odd call sites that already say
 * `formatDate(row.createdAt)` honour the account's timezone and format without
 * any of them changing.
 *
 * Re-exported from here rather than moved because that is where every caller
 * already imports them from. A component that needs to re-render the *instant*
 * a preference changes — the Settings pickers and their live sample — should
 * use `useDateFormat()` instead; everything else picks the change up on its
 * next render, which for this app means its next fetch or navigation.
 */
export { formatDay, formatRelativeDay, formatTimeOfDay } from './user-preferences';

export function formatDate(date: string | Date) {
  return formatDateTime(date);
}

export function formatRelative(date: string | Date) {
  return formatRelativeInterval(date);
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Human-readable byte size for report artifacts. Returns "—" when unknown. */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

