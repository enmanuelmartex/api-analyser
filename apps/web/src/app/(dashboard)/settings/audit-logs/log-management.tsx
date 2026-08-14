'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconAlertTriangle,
  IconDatabase,
  IconInfoCircle,
  IconLoader2,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react';
import { logsApi, settingsApi } from '@/lib/api';
import type { RuntimeSetting } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DangerZone,
  OverriddenBadge,
  SettingRow,
  SettingRowsSkeleton,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
  StatRow,
  SwitchRow,
} from '../_components/settings-primitives';
import { LogExportButton } from './log-export';

const RETENTION_PRESETS = [7, 14, 30, 60, 90] as const;
const CLEANUP_PRESETS = [1, 6, 12, 24, 48, 168] as const;

/**
 * Log Management.
 *
 * Every number on this screen is read from the API — `GET /audit/logs/stats`
 * for the table statistics and `GET /settings` for the policy. Nothing is
 * estimated in the browser: the storage figure in particular comes from
 * `pg_total_relation_size`, and renders as "unavailable" rather than a guess
 * when the query cannot run.
 */
export function LogManagement({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ['audit-logs', 'stats'],
    queryFn: logsApi.stats,
    staleTime: 30_000,
  });

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.list,
    staleTime: 60_000,
  });

  const logSettings = React.useMemo(
    () => new Map((settings.data ?? []).filter((s) => s.group === 'logs').map((s) => [s.key, s])),
    [settings.data],
  );

  const save = useMutation({
    mutationFn: (patch: Record<string, boolean | number>) => settingsApi.update(patch),
    onSuccess: (result, patch) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      if (result.changed > 0) {
        const [key] = Object.keys(patch);
        toast.success('Settings updated', {
          description: describeChange(key, logSettings.get(key), patch[key]),
        });
      }
    },
    onError: (err: any) =>
      toast.error('Could not save', {
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      }),
  });

  const cleanup = useMutation({
    mutationFn: logsApi.cleanup,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      if (result.skipped) {
        toast.info('Cleanup skipped', { description: result.reason });
      } else if (result.total === 0) {
        toast.success('Cleanup completed', {
          description: 'Nothing exceeded the retention policy.',
        });
      } else {
        toast.success('Cleanup completed', {
          description: `${result.total.toLocaleString()} old event${result.total === 1 ? '' : 's'} removed in ${result.durationMs}ms.`,
        });
      }
    },
    onError: (err: any) =>
      toast.error('Cleanup failed', {
        description: err?.response?.data?.message ?? 'The retention job did not complete.',
      }),
  });

  // Every log setting is a scalar; the list kind belongs to notifications.
  // Narrowed here rather than widened at the call sites, which all want a
  // number or a boolean and would otherwise each need the same guard.
  const value = (key: string): boolean | number | undefined => {
    const current = logSettings.get(key)?.value;
    return Array.isArray(current) ? undefined : current;
  };
  const setting = (key: string): RuntimeSetting | undefined => logSettings.get(key);

  const loading = settings.isLoading || stats.isLoading;

  if (settings.isError || stats.isError) {
    return (
      <SettingsPanel>
        <SettingsSection title="Log management" description="Control how events are stored.">
          <Alert variant="destructive">
            <IconAlertTriangle />
            <div className="flex-1">
              <AlertDescription>
                Could not load the log configuration. Statistics and policy are unavailable rather
                than estimated.
              </AlertDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  settings.refetch();
                  stats.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          </Alert>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel>
      {/* ── Collection ──────────────────────────────────────────────────── */}
      <SettingsSection
        title="Collection"
        description="What is recorded, and whether it can be watched in real time."
      >
        {loading ? (
          <SettingRowsSkeleton count={2} />
        ) : (
          <SettingsRows>
            <SwitchRow
              id="logs-collection"
              label="Log collection"
              description="Capture routine application events."
              hint="Authentication, security and configuration events — and anything at ERROR or above — are always recorded regardless of this setting. An administrator must not be able to switch off their own audit trail."
              checked={Boolean(value('logs.collectionEnabled'))}
              onCheckedChange={(next) => save.mutate({ 'logs.collectionEnabled': next })}
              disabled={!isAdmin || save.isPending}
              badge={
                setting('logs.collectionEnabled')?.source === 'database' ? (
                  <OverriddenBadge envVar={setting('logs.collectionEnabled')!.env} />
                ) : null
              }
            />
            <SwitchRow
              id="logs-live"
              label="Live streaming"
              description="Allow administrators to subscribe to the real-time event stream."
              checked={Boolean(value('logs.liveStreamEnabled'))}
              onCheckedChange={(next) => save.mutate({ 'logs.liveStreamEnabled': next })}
              disabled={!isAdmin || save.isPending}
              badge={
                setting('logs.liveStreamEnabled')?.source === 'database' ? (
                  <OverriddenBadge envVar={setting('logs.liveStreamEnabled')!.env} />
                ) : null
              }
            />
          </SettingsRows>
        )}

        {!loading && value('logs.collectionEnabled') === false && (
          <Alert variant="warning" className="mt-4">
            <IconInfoCircle />
            <AlertDescription>
              Routine events are not being recorded. Security, authentication and configuration
              events are still captured.
            </AlertDescription>
          </Alert>
        )}
      </SettingsSection>

      {/* ── Retention ───────────────────────────────────────────────────── */}
      <SettingsSection
        title="Retention"
        description="Old events are removed automatically so the table cannot grow without bound."
      >
        {loading ? (
          <SettingRowsSkeleton count={4} />
        ) : (
          <SettingsRows>
            <SwitchRow
              id="logs-retention"
              label="Automatic cleanup"
              description="Run the retention policy on a schedule."
              checked={Boolean(value('logs.retentionEnabled'))}
              onCheckedChange={(next) => save.mutate({ 'logs.retentionEnabled': next })}
              disabled={!isAdmin || save.isPending}
            />

            <SettingRow
              label="Retention period"
              description="Events older than this are deleted."
              control={
                <NumberPresetSelect
                  value={Number(value('logs.retentionDays') ?? 30)}
                  presets={RETENTION_PRESETS}
                  unit="days"
                  disabled={!isAdmin || save.isPending}
                  onChange={(next) => save.mutate({ 'logs.retentionDays': next })}
                  min={setting('logs.retentionDays')?.min}
                  max={setting('logs.retentionDays')?.max}
                />
              }
            />

            <SettingRow
              label="Maximum stored events"
              description="A hard ceiling. When exceeded, the oldest events are deleted first."
              control={
                <NumberField
                  value={Number(value('logs.maxRecords') ?? 500000)}
                  disabled={!isAdmin || save.isPending}
                  min={setting('logs.maxRecords')?.min}
                  max={setting('logs.maxRecords')?.max}
                  onCommit={(next) => save.mutate({ 'logs.maxRecords': next })}
                />
              }
            />

            <SettingRow
              label="Cleanup frequency"
              description="How often the retention job runs."
              control={
                <Select
                  value={String(value('logs.cleanupIntervalHours') ?? 24)}
                  onValueChange={(next) =>
                    save.mutate({ 'logs.cleanupIntervalHours': Number(next) })
                  }
                  disabled={!isAdmin || save.isPending}
                >
                  <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Cleanup frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLEANUP_PRESETS.map((hours) => (
                      <SelectItem key={hours} value={String(hours)}>
                        {formatInterval(hours)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          </SettingsRows>
        )}
      </SettingsSection>

      {/* ── Database ────────────────────────────────────────────────────── */}
      <SettingsSection
        title="Database"
        description="Live figures read from the events table."
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => stats.refetch()}
            disabled={stats.isFetching}
          >
            {stats.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      >
        <SettingsRows>
          <StatRow
            label="Stored events"
            value={stats.data?.total.toLocaleString() ?? '—'}
            loading={stats.isLoading}
          />
          <StatRow
            label="Oldest event"
            value={stats.data?.oldestAt ? formatDate(stats.data.oldestAt) : 'No events yet'}
            loading={stats.isLoading}
          />
          <StatRow
            label="Newest event"
            value={stats.data?.newestAt ? formatRelative(stats.data.newestAt) : 'No events yet'}
            loading={stats.isLoading}
          />
          <StatRow
            label="Storage used"
            value={
              stats.data?.storageBytes !== null && stats.data?.storageBytes !== undefined
                ? formatBytes(stats.data.storageBytes)
                : 'Unavailable'
            }
            loading={stats.isLoading}
          />
          <StatRow
            label="Live subscribers"
            value={stats.data?.liveSubscribers ?? 0}
            loading={stats.isLoading}
          />
        </SettingsRows>

        {stats.data && stats.data.total > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Object.entries(stats.data.bySeverity)
              .sort((a, b) => b[1] - a[1])
              .map(([severity, count]) => (
                <Badge key={severity} variant="neutral" className="h-5 gap-1 px-1.5 text-[10px]">
                  {severity}
                  <span className="tabular-nums text-foreground">{count.toLocaleString()}</span>
                </Badge>
              ))}
          </div>
        )}

        {stats.data?.storageBytes === null && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The on-disk size could not be read from the database. It is shown as unavailable rather
            than estimated from the row count.
          </p>
        )}
      </SettingsSection>

      {/* ── Export ──────────────────────────────────────────────────────── */}
      <SettingsSection
        title="Export"
        description="Take a copy of the audit trail out of the platform."
      >
        <SettingsRows>
          <SettingRow
            label="Export audit logs"
            description="Writes the most recent events, newest first, as CSV or JSON."
            hint="Assembled in your browser from the same endpoint the table uses, so an export always agrees with what the screen shows. To export a narrower set — one user, one category, one day — apply the filters under Audit history and export from there."
            control={
              <LogExportButton
                filters={{}}
                scopeLabel="All retained events"
                label="Export"
                disabled={(stats.data?.total ?? 0) === 0}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>

      {/* ── Maintenance ─────────────────────────────────────────────────── */}
      <SettingsSection
        title="Maintenance"
        description="Apply the policy immediately, or remove records permanently."
      >
        <div className="space-y-4">
          <SettingRow
            label="Run cleanup now"
            description={
              stats.data
                ? `Immediately deletes events older than ${stats.data.policy.retentionDays} days and trims the table to ${stats.data.policy.maxRecords.toLocaleString()} records.`
                : 'Applies the retention policy immediately.'
            }
            control={
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => cleanup.mutate()}
                disabled={!isAdmin || cleanup.isPending}
              >
                {cleanup.isPending ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconPlayerPlay className="h-4 w-4" />
                )}
                {cleanup.isPending ? 'Running…' : 'Run cleanup'}
              </Button>
            }
          />

          {cleanup.data && !cleanup.isPending && (
            <Alert variant={cleanup.data.total > 0 ? 'success' : 'default'}>
              <IconDatabase />
              <AlertDescription>
                {cleanup.data.skipped ? (
                  cleanup.data.reason
                ) : (
                  <>
                    Removed {cleanup.data.deletedByAge.toLocaleString()} by age and{' '}
                    {cleanup.data.deletedByCount.toLocaleString()} over the record limit
                    {cleanup.data.deletedNotifications > 0 &&
                      `, plus ${cleanup.data.deletedNotifications.toLocaleString()} read notifications`}{' '}
                    in {cleanup.data.durationMs}ms.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <DangerZone description="Permanently remove stored log records. This cannot be undone.">
            <PurgeDialog disabled={!isAdmin} />
          </DangerZone>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}

// ── Purge ────────────────────────────────────────────────────────────────────

const PURGE_PHRASE = 'DELETE LOGS';

/**
 * The purge confirmation.
 *
 * Two stages on purpose. Choosing a scope is a normal AlertDialog; choosing
 * "all" additionally requires the phrase to be typed, because that option
 * erases the entire audit trail including the record of the purge itself. The
 * server enforces the same phrase — a confirmation that only exists in the
 * browser is decoration.
 */
function PurgeDialog({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<'older-than-7-days' | 'older-than-30-days' | 'all'>(
    'older-than-30-days',
  );
  const [confirmation, setConfirmation] = React.useState('');

  const purge = useMutation({
    mutationFn: () =>
      logsApi.purge({ scope, confirmation: scope === 'all' ? confirmation : undefined }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Logs deleted', {
        description: `${result.deleted.toLocaleString()} record${result.deleted === 1 ? '' : 's'} permanently removed.`,
      });
      setOpen(false);
      setConfirmation('');
    },
    onError: (err: any) =>
      toast.error('Could not delete logs', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  const blocked = scope === 'all' && confirmation !== PURGE_PHRASE;

  return (
    <>
      <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <IconTrash className="h-4 w-4" />
        Delete stored logs
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmation('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stored logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected log records and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <Select value={scope} onValueChange={(next) => setScope(next as typeof scope)}>
              <SelectTrigger aria-label="How much to delete">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="older-than-7-days">Logs older than 7 days</SelectItem>
                <SelectItem value="older-than-30-days">Logs older than 30 days</SelectItem>
                <SelectItem value="all">All logs</SelectItem>
              </SelectContent>
            </Select>

            {scope === 'all' && (
              <>
                <Alert variant="destructive">
                  <IconAlertTriangle />
                  <AlertDescription>
                    This erases the entire audit trail, including the record of this deletion. The
                    log will start again from empty.
                  </AlertDescription>
                </Alert>
                <div className="space-y-1.5">
                  <label htmlFor="purge-confirm" className="text-xs text-muted-foreground">
                    Type <span className="font-mono font-medium text-foreground">{PURGE_PHRASE}</span> to
                    continue
                  </label>
                  <Input
                    id="purge-confirm"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={PURGE_PHRASE}
                    autoComplete="off"
                    className="font-mono"
                  />
                </div>
              </>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={purge.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={blocked || purge.isPending}
              onClick={(e) => {
                // The dialog closes on its own action; prevented so it stays
                // open while the request is in flight and can show the error.
                e.preventDefault();
                purge.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {purge.isPending ? 'Deleting…' : 'Delete logs'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Small controls ───────────────────────────────────────────────────────────

/** A preset list plus a "Custom" escape hatch, as the spec's retention picker. */
function NumberPresetSelect({
  value,
  presets,
  unit,
  onChange,
  disabled,
  min,
  max,
}: {
  value: number;
  presets: readonly number[];
  unit: string;
  // eslint-disable-next-line no-unused-vars
  onChange: (next: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const isPreset = presets.includes(value);
  const [custom, setCustom] = React.useState(!isPreset);

  if (custom) {
    return (
      <div className="flex items-center gap-2">
        <NumberField value={value} onCommit={onChange} disabled={disabled} min={min} max={max} />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => setCustom(false)}
          disabled={disabled}
        >
          Presets
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        if (next === 'custom') {
          setCustom(true);
          return;
        }
        onChange(Number(next));
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={`Retention in ${unit}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {presets.map((preset) => (
          <SelectItem key={preset} value={String(preset)}>
            {preset} {unit}
          </SelectItem>
        ))}
        <SelectItem value="custom">Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * A number input that saves on blur or Enter, not on every keystroke.
 *
 * Saving per-keystroke would fire a request (and an audit event) for "5", "50",
 * "500" on the way to 5000.
 */
function NumberField({
  value,
  onCommit,
  disabled,
  min,
  max,
}: {
  value: number;
  // eslint-disable-next-line no-unused-vars
  onCommit: (next: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
      toast.error('Out of range', {
        description: `Enter a value between ${min?.toLocaleString()} and ${max?.toLocaleString()}.`,
      });
      setDraft(String(value));
      return;
    }
    onCommit(Math.trunc(parsed));
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
      className="h-8 w-[140px] text-xs tabular-nums"
    />
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDate(iso);
}

function formatInterval(hours: number): string {
  if (hours === 1) return 'Every hour';
  if (hours < 24) return `Every ${hours} hours`;
  if (hours === 24) return 'Every 24 hours';
  if (hours === 168) return 'Every week';
  return `Every ${Math.round(hours / 24)} days`;
}

function describeChange(
  key: string,
  setting: RuntimeSetting | undefined,
  next: boolean | number,
): string {
  const label = setting?.label ?? key;
  if (typeof next === 'boolean') return `${label} ${next ? 'enabled' : 'disabled'}.`;
  if (key === 'logs.retentionDays') return `Log retention changed to ${next} days.`;
  return `${label} set to ${next.toLocaleString()}.`;
}
