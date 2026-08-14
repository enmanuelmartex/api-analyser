'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconAlertTriangle,
  IconBell,
  IconDatabase,
  IconInfoCircle,
  IconRadar,
  IconRotate,
} from '@tabler/icons-react';
import { settingsApi } from '@/lib/api';
import type { RuntimeSetting } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  OverriddenBadge,
  SettingRow,
  SettingRowsSkeleton,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
} from './_components/settings-primitives';

/**
 * Settings → Configuration.
 *
 * Runtime configuration, grouped by what it affects rather than presented as
 * one long form. Every control is generated from the API's own catalogue
 * (`GET /settings`) — its label, description, type and valid range all come
 * from the server's registry, so a setting added on the backend appears here
 * without a frontend change, and the bounds the UI enforces are by construction
 * the same ones the API enforces.
 *
 * Storage and log retention are deliberately NOT duplicated here. They live in
 * Audit Logs → Log Management alongside the statistics that give them meaning;
 * showing the same switch in two screens is how the two end up disagreeing.
 */

const GROUPS: {
  id: RuntimeSetting['group'];
  title: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    id: 'scanner',
    title: 'Scanner',
    description: 'Concurrency and rate limits applied to every assessment.',
    icon: IconRadar,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description:
      'Platform-wide delivery. Individual users choose which events reach them under Notifications.',
    icon: IconBell,
  },
];

export function ConfigurationTab() {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.list,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, boolean | number>) => settingsApi.update(patch),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      if (result.changed > 0) {
        toast.success('Settings updated', {
          description: `${result.changed} setting${result.changed === 1 ? '' : 's'} changed. The change is recorded in the audit log.`,
        });
      }
    },
    onError: (err: any) =>
      toast.error('Could not save', {
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      }),
  });

  const reset = useMutation({
    mutationFn: (key: string) => settingsApi.reset(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Reset to default', {
        description: 'The environment value applies again.',
      });
    },
    onError: (err: any) =>
      toast.error('Could not reset', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  if (settings.isError) {
    return (
      <SettingsPanel>
        <SettingsSection title="Configuration" description="Runtime behaviour of this instance.">
          <Alert variant="destructive">
            <IconAlertTriangle />
            <div className="flex-1">
              <AlertDescription>
                Could not load the configuration. Values are unavailable rather than guessed.
              </AlertDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => settings.refetch()}
              >
                Retry
              </Button>
            </div>
          </Alert>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  const byGroup = (group: string) =>
    (settings.data ?? []).filter((setting) => setting.group === group);

  return (
    <div className="space-y-5">
      <Alert variant="info">
        <IconInfoCircle />
        <AlertDescription>
          A value set here overrides its environment variable without a redeploy. Reset one to fall
          back to the environment. Nothing on this screen writes to your{' '}
          <span className="font-mono text-xs">.env</span> file.
        </AlertDescription>
      </Alert>

      <SettingsPanel>
        {GROUPS.map((group) => {
          const items = byGroup(group.id);
          if (!settings.isLoading && items.length === 0) return null;

          return (
            <SettingsSection
              key={group.id}
              title={group.title}
              description={group.description}
              action={
                <group.icon
                  className="h-4 w-4 text-muted-foreground/60"
                  aria-hidden="true"
                />
              }
            >
              {settings.isLoading ? (
                <SettingRowsSkeleton count={3} />
              ) : (
                <SettingsRows>
                  {items.map((setting) => (
                    <ConfigRow
                      key={setting.key}
                      setting={setting}
                      saving={save.isPending}
                      onChange={(value) => save.mutate({ [setting.key]: value })}
                      onReset={() => reset.mutate(setting.key)}
                      resetting={reset.isPending}
                    />
                  ))}
                </SettingsRows>
              )}
            </SettingsSection>
          );
        })}

        <SettingsSection
          title="Storage and logs"
          description="Retention, cleanup and database statistics."
        >
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <IconDatabase
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Log collection, retention period, maximum stored events, cleanup frequency and the
              purge controls live in{' '}
              <span className="font-medium text-foreground">Audit logs → Log management</span>, next
              to the table statistics that give those numbers meaning. They are not duplicated here
              so the two screens cannot disagree.
            </p>
          </div>
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}

/**
 * One setting, rendered from its definition.
 *
 * The `kind` discriminator decides the control. Numbers commit on blur rather
 * than per keystroke — otherwise typing "3000" fires four saves and four audit
 * events on the way there.
 */
function ConfigRow({
  setting,
  onChange,
  onReset,
  saving,
  resetting,
}: {
  setting: RuntimeSetting;
  // eslint-disable-next-line no-unused-vars
  onChange: (value: boolean | number) => void;
  onReset: () => void;
  saving: boolean;
  resetting: boolean;
}) {
  const overridden = setting.source === 'database';

  const control =
    setting.kind === 'boolean' ? (
      <Switch
        id={`setting-${setting.key}`}
        checked={Boolean(setting.value)}
        onCheckedChange={onChange}
        disabled={saving}
        aria-label={setting.label}
      />
    ) : (
      <CommitNumberInput
        id={`setting-${setting.key}`}
        value={Number(setting.value)}
        min={setting.min}
        max={setting.max}
        disabled={saving}
        onCommit={onChange}
      />
    );

  return (
    <SettingRow
      htmlFor={`setting-${setting.key}`}
      label={setting.label}
      description={setting.description}
      hint={`Environment default: ${setting.env}=${setting.default}`}
      control={
        <>
          {overridden && <OverriddenBadge envVar={setting.env} />}
          {overridden && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={onReset}
                  disabled={resetting}
                  aria-label={`Reset ${setting.label} to the environment default`}
                >
                  <IconRotate className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to the environment default</TooltipContent>
            </Tooltip>
          )}
          {control}
        </>
      }
    />
  );
}

function CommitNumberInput({
  id,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  // eslint-disable-next-line no-unused-vars
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || Math.trunc(parsed) === value) {
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
      id={id}
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
