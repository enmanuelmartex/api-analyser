import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Severity } from '@/types';

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

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatRelative(date: string | Date) {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
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

