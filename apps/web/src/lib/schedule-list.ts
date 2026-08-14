import type {
  ScheduleDisplayStatus,
  ScheduleExecutionStatus,
  ScheduleFrequency,
} from '@/types';

/**
 * Everything the Scheduled Scans screens need to agree on: the filter state and
 * its URL encoding, the labels, and the timezone-aware formatting.
 *
 * Kept next to the URL helpers rather than inside a component so that a card,
 * an empty state or a dashboard link can build a filtered view without
 * importing the filter bar — the same arrangement `issue-list.ts` uses.
 */

/** The sentinel a Select uses for "no filter". Radix rejects an empty value. */
export const ANY = 'ANY';

export interface ScheduleFilterState {
  search: string;
  status: string;
  frequency: string;
  projectId: string;
}

export const EMPTY_SCHEDULE_FILTERS: ScheduleFilterState = {
  search: '',
  status: ANY,
  frequency: ANY,
  projectId: ANY,
};

export function parseScheduleFilters(params: URLSearchParams): ScheduleFilterState {
  return {
    search: params.get('search') ?? '',
    status: params.get('status') ?? ANY,
    frequency: params.get('frequency') ?? ANY,
    projectId: params.get('projectId') ?? ANY,
  };
}

export function parseSchedulePage(params: URLSearchParams): number {
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/**
 * Filters live in the URL, so a filtered view is shareable and survives a
 * reload. Changing a filter always returns to page 1: keeping the offset would
 * land on an empty page whenever the narrower result set is shorter.
 */
export function serializeScheduleFilters(filters: ScheduleFilterState, page = 1): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status !== ANY) params.set('status', filters.status);
  if (filters.frequency !== ANY) params.set('frequency', filters.frequency);
  if (filters.projectId !== ANY) params.set('projectId', filters.projectId);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

export function hasActiveScheduleFilters(filters: ScheduleFilterState): boolean {
  return (
    filters.search !== '' ||
    filters.status !== ANY ||
    filters.frequency !== ANY ||
    filters.projectId !== ANY
  );
}

/** `ANY` means "no filter", so it must not be sent to the API. */
export function toApiValue(value: string): string | undefined {
  return value === ANY ? undefined : value;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  ONCE: 'Once',
  HOURLY: 'Hourly',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  CUSTOM: 'Custom',
};

export const FREQUENCY_ORDER: ScheduleFrequency[] = [
  'ONCE',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'CUSTOM',
];

/**
 * Status presentation, in the product's severity vocabulary.
 *
 * `dot` matches the pattern the Issues and Scans filters already use, so the
 * three screens read as one product.
 */
export const SCHEDULE_STATUS_META: Record<
  ScheduleDisplayStatus,
  { label: string; dot: string; className: string }
> = {
  ACTIVE: {
    label: 'Active',
    dot: 'bg-emerald-500',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  RUNNING: {
    label: 'Running',
    dot: 'bg-sky-500',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  PAUSED: {
    label: 'Paused',
    dot: 'bg-amber-500',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  FAILED: {
    label: 'Failed',
    dot: 'bg-destructive',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
  COMPLETED: {
    label: 'Completed',
    dot: 'bg-muted-foreground',
    className: 'border-border bg-muted text-muted-foreground',
  },
};

/** The statuses a user may filter by — the three that are actually stored. */
export const FILTERABLE_STATUSES: ScheduleDisplayStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED'];

export const EXECUTION_STATUS_META: Record<
  ScheduleExecutionStatus,
  { label: string; className: string }
> = {
  QUEUED: { label: 'Queued', className: 'border-border bg-muted text-muted-foreground' },
  RUNNING: {
    label: 'Running',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  FAILED: { label: 'Failed', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  CANCELLED: { label: 'Cancelled', className: 'border-border bg-muted text-muted-foreground' },
  SKIPPED: {
    label: 'Skipped',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Initials for the compact day picker. Index matches `WEEKDAY_LABELS`. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ── Timezone-aware formatting ────────────────────────────────────────────────

/**
 * An instant, rendered in the SCHEDULE's timezone rather than the browser's.
 *
 * This is the whole point of storing a zone per schedule. An operator in Madrid
 * administering an API scanned at 02:00 Santo Domingo must see 02:00 — the time
 * they configured — not 08:00, which is the same instant but answers a
 * different question and makes the schedule look wrong.
 */
export function formatInZone(
  instant: string | Date | null | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!instant) return '—';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...options,
    }).format(date);
  } catch {
    // An unknown zone should never reach here — the server validates it — but a
    // thrown RangeError inside a table cell would blank the whole page.
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...options,
    }).format(date);
  }
}

/** Same, without the year — for dense table columns. */
export function formatRunAt(instant: string | Date | null | undefined, timeZone: string): string {
  return formatInZone(instant, timeZone, { year: undefined });
}

/**
 * "in 4 hours", "tomorrow", "3 days ago" — the reading a table column wants.
 *
 * Relative time is zone-independent (it is a difference between instants), so
 * it is the one part of this file that does not need the schedule's zone. It
 * accompanies the absolute time rather than replacing it: "tomorrow" alone is
 * useless for deciding whether a scan will hit a maintenance window.
 */
export function formatCountdown(instant: string | Date | null | undefined): string {
  if (!instant) return '';
  const target = new Date(instant).getTime();
  if (Number.isNaN(target)) return '';

  const deltaMs = target - Date.now();
  const past = deltaMs < 0;
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);

  const phrase = (() => {
    if (minutes < 1) return 'less than a minute';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? '' : 's'}`;
  })();

  return past ? `${phrase} ago` : `in ${phrase}`;
}

/**
 * The paused/completed placeholder for a "Next run" column.
 *
 * A paused schedule has no next run, and showing a stale date would suggest it
 * is still going to scan.
 */
export function nextRunLabel(
  nextRunAt: string | null,
  status: ScheduleDisplayStatus,
  timeZone: string,
): string {
  if (status === 'PAUSED') return 'Paused';
  if (!nextRunAt) return '—';
  return formatRunAt(nextRunAt, timeZone);
}
