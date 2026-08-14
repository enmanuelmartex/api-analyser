'use client';

import Link from 'next/link';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  IconAlertTriangle,
  IconBolt,
  IconCalendarClock,
  IconLayersLinked,
  IconPlug,
  IconSparkles,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { pluginsApi, profilesApi, projectsApi, scheduledScansApi, type ScheduleInput } from '@/lib/api';
import type { Plugin, Project, ScanProfile, ScheduleFrequency, ScheduledScan, SchedulePreview } from '@/types';
import {
  FREQUENCY_LABELS,
  FREQUENCY_ORDER,
  WEEKDAY_INITIALS,
  WEEKDAY_LABELS,
  formatInZone,
} from '@/lib/schedule-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { TimezoneSelect, detectTimeZone } from './timezone-select';

/** Hourly presets, plus the escape hatch for anything else. */
const HOURLY_PRESETS = [1, 2, 4, 6, 12];

type ExecutionMode = 'all' | 'profile' | 'manual';

interface FormState {
  name: string;
  projectId: string;
  frequency: ScheduleFrequency;
  timezone: string;
  hour: number;
  minute: number;
  intervalHours: number;
  weekdays: number[];
  monthDay: number;
  cronExpression: string;
  /** `yyyy-MM-dd`, in the schedule's zone, for ONCE. */
  onceDate: string;
  executionMode: ExecutionMode;
  scanProfileId: string;
  manualPlugins: string[];
  enableAiAnalysis: boolean;
  skipIfRunning: boolean;
}

function initialState(schedule?: ScheduledScan, projectId?: string): FormState {
  if (schedule) {
    return {
      name: schedule.name,
      projectId: schedule.projectId,
      frequency: schedule.frequency,
      timezone: schedule.timezone,
      hour: schedule.hour ?? 2,
      minute: schedule.minute ?? 0,
      intervalHours: schedule.intervalHours ?? 6,
      weekdays: schedule.weekdays.length ? schedule.weekdays : [1],
      monthDay: schedule.monthDay ?? 1,
      cronExpression: schedule.cronExpression ?? '0 2 * * 1',
      onceDate: schedule.startAt ? isoDateInZone(schedule.startAt, schedule.timezone) : tomorrowInZone(schedule.timezone),
      executionMode: schedule.executionMode,
      scanProfileId: schedule.scanProfileId ?? '',
      manualPlugins: schedule.manualPlugins,
      enableAiAnalysis: schedule.enableAiAnalysis,
      skipIfRunning: schedule.skipIfRunning,
    };
  }

  const timezone = detectTimeZone();
  return {
    name: '',
    projectId: projectId ?? '',
    frequency: 'WEEKLY',
    timezone,
    hour: 2,
    minute: 0,
    intervalHours: 6,
    weekdays: [1],
    monthDay: 1,
    cronExpression: '0 2 * * 1',
    onceDate: tomorrowInZone(timezone),
    executionMode: 'all',
    scanProfileId: '',
    manualPlugins: [],
    enableAiAnalysis: true,
    skipIfRunning: true,
  };
}

/** `yyyy-MM-dd` for an instant, read in a given zone. */
function isoDateInZone(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString().slice(0, 10);
  }
}

function tomorrowInZone(timeZone: string): string {
  return isoDateInZone(new Date(Date.now() + 86_400_000).toISOString(), timeZone);
}

/**
 * The payload the API expects, built from the form.
 *
 * ONCE is the only case that needs assembling: the operator picks a date and a
 * time in the schedule's zone, and the server needs one instant. The two are
 * sent as the local wall time plus the zone, and the server converts — so the
 * browser's own offset never enters into it.
 */
function toInput(state: FormState, includeProject: boolean): ScheduleInput {
  const base: ScheduleInput = {
    name: state.name.trim(),
    frequency: state.frequency,
    timezone: state.timezone,
    executionMode: state.executionMode,
    enableAiAnalysis: state.enableAiAnalysis,
    skipIfRunning: state.skipIfRunning,
    ...(includeProject ? { projectId: state.projectId } : {}),
    ...(state.executionMode === 'profile' ? { scanProfileId: state.scanProfileId } : {}),
    ...(state.executionMode === 'manual' ? { manualPlugins: state.manualPlugins } : {}),
  };

  switch (state.frequency) {
    case 'ONCE':
      return { ...base, startAt: wallTimeToIso(state.onceDate, state.hour, state.minute, state.timezone) };
    case 'HOURLY':
      return { ...base, intervalHours: state.intervalHours, hour: state.hour, minute: state.minute };
    case 'DAILY':
      return { ...base, hour: state.hour, minute: state.minute };
    case 'WEEKLY':
      return { ...base, hour: state.hour, minute: state.minute, weekdays: state.weekdays };
    case 'MONTHLY':
      return { ...base, hour: state.hour, minute: state.minute, monthDay: state.monthDay };
    case 'CUSTOM':
      return { ...base, cronExpression: state.cronExpression.trim() };
    default:
      return base;
  }
}

/**
 * A wall-clock date and time in a named zone → the UTC instant it denotes.
 *
 * Deliberately does the two-pass offset resolution rather than
 * `new Date('2026-08-17T02:00')`, which the browser interprets in ITS OWN zone.
 * That difference is the entire bug this feature exists to avoid: an operator
 * in Madrid scheduling 02:00 Santo Domingo would otherwise store 02:00 CEST.
 */
function wallTimeToIso(date: string, hour: number, minute: number, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const asUtc = Date.UTC(year, (month ?? 1) - 1, day ?? 1, hour, minute, 0);

  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const read: Record<string, string> = {};
    for (const part of parts) if (part.type !== 'literal') read[part.type] = part.value;
    return (
      Date.UTC(
        Number(read.year),
        Number(read.month) - 1,
        Number(read.day),
        Number(read.hour) % 24,
        Number(read.minute),
        Number(read.second),
      ) - instant
    );
  };

  try {
    const guess = offsetAt(asUtc);
    const first = asUtc - guess;
    const settled = offsetAt(first);
    return new Date(settled === guess ? first : asUtc - settled).toISOString();
  } catch {
    return new Date(asUtc).toISOString();
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message ?? error.response?.data?.error;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export interface ScheduleSheetProps {
  /** Editing an existing schedule when given; creating one otherwise. */
  schedule?: ScheduledScan;
  /** Pre-selects and locks the project, when opened from a project. */
  project?: Project;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (_open: boolean) => void;
}

/**
 * Create or edit a scheduled scan.
 *
 * The frequency controls are progressive: only the fields the chosen frequency
 * actually uses are rendered, so a weekly schedule never shows a day-of-month
 * field. Underneath them sits a live preview of what the rule means — computed
 * by the SERVER, from the same code that will fire the schedule, so the
 * sentence the operator confirms is the behaviour they get.
 */
export function ScheduleSheet({
  schedule,
  project,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: ScheduleSheetProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const isEdit = Boolean(schedule);
  const lockedProject = Boolean(project) && !isEdit;

  const [state, setState] = React.useState<FormState>(() => initialState(schedule, project?.id));
  const [submitError, setSubmitError] = React.useState('');

  // Reset whenever the sheet opens, so a cancelled edit does not leak into the
  // next one and a second create starts clean.
  React.useEffect(() => {
    if (open) {
      setState(initialState(schedule, project?.id));
      setSubmitError('');
    }
  }, [open, schedule, project?.id]);

  const patch = React.useCallback(
    (changes: Partial<FormState>) => setState((current) => ({ ...current, ...changes })),
    [],
  );

  const projectsQuery = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    enabled: open && !lockedProject && !isEdit,
  });
  const pluginsQuery = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: pluginsApi.list,
    enabled: open,
  });
  const profilesQuery = useQuery<ScanProfile[]>({
    queryKey: ['scan-profiles'],
    queryFn: profilesApi.list,
    enabled: open,
  });

  const enabledPlugins = React.useMemo(
    () => (pluginsQuery.data ?? []).filter((plugin) => plugin.isEnabled),
    [pluginsQuery.data],
  );
  const profiles = profilesQuery.data ?? [];
  // Only projects that can actually be scanned. Offering a draft here would
  // produce a schedule the server refuses at the moment of saving.
  const scannableProjects = (projectsQuery.data ?? []).filter(
    (candidate) => candidate.status === 'READY',
  );

  /*
   * The live preview.
   *
   * Debounced against the assembled payload rather than each field, so typing a
   * cron expression issues one request rather than one per character. Errors are
   * kept and shown: a rejected preview is the earliest, clearest place to learn
   * that `* * * * *` is not allowed.
   */
  const [previewInput, setPreviewInput] = React.useState<ScheduleInput | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setPreviewInput(toInput(state, true)), 300);
    return () => clearTimeout(id);
  }, [open, state]);

  const previewQuery = useQuery<SchedulePreview>({
    queryKey: ['scheduled-scans', 'preview', previewInput],
    queryFn: () =>
      scheduledScansApi.preview({
        ...(previewInput as ScheduleInput),
        // The preview only validates the recurrence, so it must not fail for a
        // name or a project the operator has not filled in yet.
        name: previewInput?.name || 'Preview',
        projectId: previewInput?.projectId || 'preview',
        executionMode: 'all',
      }),
    enabled: open && Boolean(previewInput),
    retry: false,
  });

  const previewError = previewQuery.isError
    ? errorMessage(previewQuery.error, 'This recurrence is not valid.')
    : '';

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? scheduledScansApi.update(schedule!.id, toInput(state, false))
        : scheduledScansApi.create(toInput(state, true)),
    onMutate: () => setSubmitError(''),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-scans'] });
      setOpen(false);
      toast.success(isEdit ? 'Schedule updated' : 'Schedule created', {
        description: `${saved.description} · ${saved.timezone}`,
      });
    },
    onError: (error) =>
      setSubmitError(
        errorMessage(error, isEdit ? 'The schedule could not be saved.' : 'The schedule could not be created.'),
      ),
  });

  const selectedProfile = profiles.find((candidate) => candidate.id === state.scanProfileId);
  const projectName =
    project?.name ??
    schedule?.project.name ??
    scannableProjects.find((candidate) => candidate.id === state.projectId)?.name ??
    '';

  const isValid =
    state.name.trim().length > 0 &&
    (isEdit || state.projectId.length > 0) &&
    !previewQuery.isError &&
    (state.executionMode !== 'profile' || state.scanProfileId.length > 0) &&
    (state.executionMode !== 'manual' || state.manualPlugins.length > 0) &&
    (state.frequency !== 'WEEKLY' || state.weekdays.length > 0);

  const toggleWeekday = (day: number) =>
    setState((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((existing) => existing !== day)
        : [...current.weekdays, day].sort((a, b) => a - b),
    }));

  const toggleManualPlugin = (pluginId: string, checked: boolean) =>
    setState((current) => ({
      ...current,
      manualPlugins: checked
        ? [...new Set([...current.manualPlugins, pluginId])]
        : current.manualPlugins.filter((id) => id !== pluginId),
    }));

  return (
    <Sheet open={open} onOpenChange={(next) => !mutation.isPending && setOpen(next)}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className="flex h-dvh w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{isEdit ? 'Edit schedule' : 'Schedule scan'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Changes take effect from the next run. Scans already completed are unaffected.'
              : 'Run this security assessment automatically, without anyone having to be here.'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-5">
            {/* ── Identity ─────────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Schedule name</Label>
              <Input
                id="schedule-name"
                value={state.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="Weekly Production Scan"
                maxLength={120}
              />
            </div>

            {isEdit || lockedProject ? (
              <div className="space-y-2">
                <Label>Project</Label>
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                  {projectName || '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isEdit
                    ? 'A schedule stays with its project, so its history keeps describing the same API.'
                    : 'Scheduling from this project.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="schedule-project">Project</Label>
                <Select value={state.projectId} onValueChange={(value) => patch({ projectId: value })}>
                  <SelectTrigger id="schedule-project" className="h-9">
                    <SelectValue placeholder="Select the API to scan" />
                  </SelectTrigger>
                  <SelectContent>
                    {scannableProjects.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!projectsQuery.isLoading && scannableProjects.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No project is ready to scan yet.{' '}
                    <Link href="/projects/new" className="text-primary hover:underline">
                      Create one
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            {/* ── Recurrence ───────────────────────────────────────────── */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Frequency</legend>
              <div className="grid grid-cols-3 gap-2">
                {FREQUENCY_ORDER.map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    onClick={() => patch({ frequency })}
                    aria-pressed={state.frequency === frequency}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm transition-colors',
                      state.frequency === frequency
                        ? 'border-primary bg-primary/5 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {FREQUENCY_LABELS[frequency]}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Only the controls the chosen frequency actually uses. */}
            {state.frequency === 'ONCE' && (
              <div className="space-y-2">
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={state.onceDate}
                  onChange={(event) => patch({ onceDate: event.target.value })}
                  className="h-9"
                />
              </div>
            )}

            {state.frequency === 'HOURLY' && (
              <div className="space-y-2">
                <Label htmlFor="schedule-interval">Repeat every</Label>
                <div className="flex flex-wrap gap-2">
                  {HOURLY_PRESETS.map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      onClick={() => patch({ intervalHours: hours })}
                      aria-pressed={state.intervalHours === hours}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm transition-colors',
                        state.intervalHours === hours
                          ? 'border-primary bg-primary/5 font-medium'
                          : 'text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      {hours === 1 ? '1 hour' : `${hours} hours`}
                    </button>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      id="schedule-interval"
                      type="number"
                      min={1}
                      max={23}
                      value={state.intervalHours}
                      onChange={(event) =>
                        patch({ intervalHours: Math.min(23, Math.max(1, Number(event.target.value) || 1)) })
                      }
                      className="h-8 w-20"
                      aria-label="Custom interval in hours"
                    />
                    <span className="text-sm text-muted-foreground">hours</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Measured from the first run below, in real elapsed time — so the spacing stays exact
                  across a daylight-saving change.
                </p>
              </div>
            )}

            {state.frequency === 'WEEKLY' && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Repeat on</legend>
                <div className="flex gap-1.5">
                  {WEEKDAY_INITIALS.map((initial, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      aria-pressed={state.weekdays.includes(day)}
                      aria-label={WEEKDAY_LABELS[day]}
                      title={WEEKDAY_LABELS[day]}
                      className={cn(
                        'size-9 rounded-full border text-sm transition-colors',
                        state.weekdays.includes(day)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {initial}
                    </button>
                  ))}
                </div>
                {state.weekdays.length === 0 && (
                  <p className="text-xs text-destructive">Select at least one day.</p>
                )}
              </fieldset>
            )}

            {state.frequency === 'MONTHLY' && (
              <div className="space-y-2">
                <Label htmlFor="schedule-monthday">Day of the month</Label>
                <Select
                  value={String(state.monthDay)}
                  onValueChange={(value) => patch({ monthDay: Number(value) })}
                >
                  <SelectTrigger id="schedule-monthday" className="h-9 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        Day {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state.monthDay > 28 && (
                  <p className="text-xs text-muted-foreground">
                    Months shorter than day {state.monthDay} run on their last day, so no month is
                    skipped.
                  </p>
                )}
              </div>
            )}

            {state.frequency === 'CUSTOM' ? (
              <div className="space-y-2">
                <Label htmlFor="schedule-cron">Cron expression</Label>
                <Input
                  id="schedule-cron"
                  value={state.cronExpression}
                  onChange={(event) => patch({ cronExpression: event.target.value })}
                  placeholder="0 2 * * 1"
                  className="h-9 font-mono"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Five fields: minute, hour, day of month, month, day of week. Evaluated in the
                  timezone below. Runs must be at least 15 minutes apart.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="schedule-hour">
                    {state.frequency === 'HOURLY' ? 'First run at' : 'Time'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(state.hour)}
                      onValueChange={(value) => patch({ hour: Number(value) })}
                    >
                      <SelectTrigger id="schedule-hour" className="h-9" aria-label="Hour">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, hour) => (
                          <SelectItem key={hour} value={String(hour)}>
                            {String(hour).padStart(2, '0')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">:</span>
                    <Select
                      value={String(state.minute)}
                      onValueChange={(value) => patch({ minute: Number(value) })}
                    >
                      <SelectTrigger className="h-9" aria-label="Minute">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((minute) => (
                          <SelectItem key={minute} value={String(minute)}>
                            {String(minute).padStart(2, '0')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule-timezone">Timezone</Label>
                  <TimezoneSelect
                    id="schedule-timezone"
                    value={state.timezone}
                    onChange={(timezone) => patch({ timezone })}
                  />
                </div>
              </div>
            )}

            {state.frequency === 'CUSTOM' && (
              <div className="space-y-2">
                <Label htmlFor="schedule-timezone-custom">Timezone</Label>
                <TimezoneSelect
                  id="schedule-timezone-custom"
                  value={state.timezone}
                  onChange={(timezone) => patch({ timezone })}
                />
              </div>
            )}

            {/* ── The live preview ─────────────────────────────────────── */}
            <section
              aria-live="polite"
              className={cn(
                'rounded-lg border p-4',
                previewError ? 'border-destructive/30 bg-destructive/5' : 'bg-muted/30',
              )}
            >
              {previewError ? (
                <p className="flex gap-2 text-sm text-destructive">
                  <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {previewError}
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <IconCalendarClock className="size-4 text-primary" />
                    {previewQuery.data?.description ?? 'Choose a frequency to see the schedule.'}
                  </p>
                  {previewQuery.data && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {previewQuery.data.timezone} ({previewQuery.data.timezoneOffset})
                    </p>
                  )}
                  {previewQuery.data?.nextRuns?.length ? (
                    <dl className="mt-3 space-y-1 border-t pt-3 text-xs">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">First execution</dt>
                        <dd className="font-medium">
                          {formatInZone(previewQuery.data.nextRuns[0], previewQuery.data.timezone, {
                            weekday: 'short',
                          })}
                        </dd>
                      </div>
                      {previewQuery.data.nextRuns.slice(1, 3).map((run) => (
                        <div key={run} className="flex justify-between gap-4 text-muted-foreground">
                          <dt>then</dt>
                          <dd>
                            {formatInZone(run, previewQuery.data!.timezone, { weekday: 'short' })}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </>
              )}
            </section>

            {/* ── What to run ──────────────────────────────────────────── */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Scan configuration</legend>
              <RadioGroup
                value={state.executionMode}
                onValueChange={(value) => patch({ executionMode: value as ExecutionMode })}
              >
                {[
                  {
                    value: 'all',
                    title: 'All enabled checks',
                    description: 'Whatever is enabled at the time of each run.',
                    icon: IconBolt,
                  },
                  {
                    value: 'profile',
                    title: 'Scan profile',
                    description: 'A saved selection, such as Full Scan or Quick Scan.',
                    icon: IconLayersLinked,
                  },
                  {
                    value: 'manual',
                    title: 'Specific checks',
                    description: 'Pick the checks this schedule should run.',
                    icon: IconPlug,
                  },
                ].map((option) => {
                  const Icon = option.icon;
                  const selected = state.executionMode === option.value;
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        selected ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                      )}
                    >
                      <RadioGroupItem value={option.value} className="mt-1" />
                      <Icon className="mt-0.5 size-5 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{option.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>

            {state.executionMode === 'profile' && (
              <div className="space-y-2">
                <Label htmlFor="schedule-profile">Scan profile</Label>
                <Select
                  value={state.scanProfileId}
                  onValueChange={(value) => patch({ scanProfileId: value })}
                >
                  <SelectTrigger id="schedule-profile" className="h-9">
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProfile && (
                  <p className="text-xs text-muted-foreground">
                    {selectedProfile.enabledPlugins.length} check
                    {selectedProfile.enabledPlugins.length === 1 ? '' : 's'}
                    {selectedProfile.description ? ` · ${selectedProfile.description}` : ''}
                  </p>
                )}
              </div>
            )}

            {state.executionMode === 'manual' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Security checks</Label>
                  <span className="text-xs text-muted-foreground">
                    {state.manualPlugins.length} selected
                  </span>
                </div>
                <div className="space-y-2">
                  {enabledPlugins.map((plugin) => (
                    <label
                      key={plugin.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={state.manualPlugins.includes(plugin.id)}
                        onCheckedChange={(checked) => toggleManualPlugin(plugin.id, checked === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{plugin.name}</span>
                          <Badge variant="outline">{plugin.category}</Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {plugin.description}
                        </span>
                      </span>
                    </label>
                  ))}
                  {!pluginsQuery.isLoading && enabledPlugins.length === 0 && (
                    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No checks are enabled.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Options ──────────────────────────────────────────────── */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <IconSparkles className="mt-0.5 size-5 text-ai" />
                  <div>
                    <p className="text-sm font-medium">AI security enrichment</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Adds root cause, impact and remediation guidance to eligible findings.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={state.enableAiAnalysis}
                  onCheckedChange={(checked) => patch({ enableAiAnalysis: checked })}
                  aria-label="Enable AI security enrichment"
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-3">
                <div>
                  <p className="text-sm font-medium">Skip if a scan is still running</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Prevents this schedule stacking scans against the same API when a run takes
                    longer than the interval.
                  </p>
                </div>
                <Switch
                  checked={state.skipIfRunning}
                  onCheckedChange={(checked) => patch({ skipIfRunning: checked })}
                  aria-label="Skip a run while the previous one is still going"
                />
              </div>
            </div>

            {submitError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {submitError}
              </p>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="border-t bg-card">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!isValid} loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
