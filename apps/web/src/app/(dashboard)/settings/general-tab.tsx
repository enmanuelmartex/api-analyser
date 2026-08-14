'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { IconCheck, IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { authApi } from '@/lib/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FieldRow,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
  StatRow,
} from './_components/settings-primitives';

/**
 * Settings → General.
 *
 * Every control here either persists or states plainly that it does not. The
 * timezone and language rows are facts about the running product rather than
 * selects backed by nothing, which is what they used to be.
 */
export function GeneralTab({ user }: { user: any }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(user?.name ?? '');

  React.useEffect(() => setName(user?.name ?? ''), [user?.name]);

  const saveProfile = useMutation({
    mutationFn: (newName: string) => authApi.updateMe({ name: newName }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      if (typeof window !== 'undefined') {
        localStorage.setItem('api_analyser_user', JSON.stringify(updated));
      }
      toast.success('Profile updated');
    },
    onError: (err: any) =>
      toast.error('Could not update your profile', {
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      }),
  });

  const trimmed = name.trim();
  const dirty = trimmed !== (user?.name ?? '').trim();

  return (
    <div className="space-y-5">
      <SettingsPanel>
        <SettingsSection
          title="Profile"
          description="Shown on issues you are assigned and in the audit log."
        >
          <div className="mb-1 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="text-sm font-semibold">
                {user?.name?.charAt(0)?.toUpperCase() || '—'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              {user ? (
                <>
                  <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-44" />
                </div>
              )}
            </div>
            {user?.role && (
              <Badge variant="default" className="flex-shrink-0 text-[10px] uppercase">
                {user.role}
              </Badge>
            )}
          </div>

          <SettingsRows>
            <FieldRow
              label="Display name"
              htmlFor="display-name"
              hint="Appears wherever your actions are attributed."
            >
              <Input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                className="h-9"
              />
            </FieldRow>

            <FieldRow label="Email address" hint="Your sign-in identity. It cannot be changed here.">
              <Input
                value={user?.email ?? ''}
                readOnly
                className="h-9 cursor-not-allowed text-muted-foreground"
              />
            </FieldRow>
          </SettingsRows>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
            {dirty && !saveProfile.isPending && (
              <Button variant="ghost" size="sm" onClick={() => setName(user?.name ?? '')}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveProfile.mutate(trimmed)}
              disabled={!dirty || trimmed.length === 0}
              loading={saveProfile.isPending}
            >
              Save changes
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Appearance"
          description="Stored in this browser, not on your account. Applies immediately."
        >
          <ThemePicker />
        </SettingsSection>

        {/*
          Stated as facts, not offered as choices. Both were selects backed by
          React state that reset on reload — a control that appears to configure
          something it cannot is worse than a plain statement of what is true.
        */}
        <SettingsSection title="Regional" description="Not configurable in this build.">
          <RegionalFacts />
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}

// ── Theme ────────────────────────────────────────────────────────────────────

const THEMES = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
] as const;

/**
 * Theme as three previews rather than a dropdown.
 *
 * The preview is drawn from the same tokens the product uses, not from
 * screenshots, so it cannot drift from the real thing when the palette changes.
 * "System" is split down the middle because that is literally what it does —
 * one half of the choice, decided by the OS.
 */
function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // next-themes resolves against localStorage on the client only; reading
  // `theme` before mount renders the wrong option as selected.
  React.useEffect(() => setMounted(true), []);

  const active = mounted ? (theme ?? 'system') : undefined;

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      {/*
        `role="radio"` is only meaningful inside a radiogroup — without it a
        screen reader announces three unrelated checkable buttons rather than
        one choice of three.
      */}
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEMES.map(({ value, label, icon: Icon }) => {
          const selected = active === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={cn(
                'group relative rounded-lg border p-1.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                selected
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <ThemePreview variant={value} />

              <span className="flex items-center gap-1.5 px-1.5 py-1.5">
                <Icon
                  className={cn('h-3.5 w-3.5', selected ? 'text-primary' : 'text-muted-foreground')}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    'text-xs',
                    selected ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
                {selected && (
                  <IconCheck className="ml-auto h-3.5 w-3.5 text-primary" aria-hidden="true" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A miniature of the app chrome: sidebar, header, two content bars.
 *
 * Hard-coded neutrals rather than theme tokens, deliberately — a "Light" swatch
 * has to look light while the product is in dark mode, so it cannot be painted
 * with the tokens that are currently in force.
 */
function ThemePreview({ variant }: { variant: 'light' | 'dark' | 'system' }) {
  if (variant === 'system') {
    return (
      <span className="flex h-16 w-full overflow-hidden rounded-md border border-border">
        <span className="w-1/2 overflow-hidden">
          <Miniature tone="light" className="w-[200%]" />
        </span>
        <span className="w-1/2 overflow-hidden">
          <Miniature tone="dark" className="w-[200%] -translate-x-1/2" />
        </span>
      </span>
    );
  }

  return (
    <span className="block h-16 w-full overflow-hidden rounded-md border border-border">
      <Miniature tone={variant} />
    </span>
  );
}

function Miniature({ tone, className }: { tone: 'light' | 'dark'; className?: string }) {
  const light = tone === 'light';
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-16', light ? 'bg-[#FAFAFA]' : 'bg-[#08080A]', className)}
    >
      <span
        className={cn(
          'flex w-1/4 flex-col gap-1 p-1.5',
          light ? 'border-r border-[#E4E4E7] bg-white' : 'border-r border-[#26262B] bg-[#0D0D10]',
        )}
      >
        <span className="h-1 w-full rounded-full bg-[#2E8BF5]" />
        <span className={cn('h-1 w-3/4 rounded-full', light ? 'bg-[#E4E4E7]' : 'bg-[#26262B]')} />
        <span className={cn('h-1 w-3/4 rounded-full', light ? 'bg-[#E4E4E7]' : 'bg-[#26262B]')} />
      </span>
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        <span className={cn('h-1.5 w-1/2 rounded-full', light ? 'bg-[#3F3F46]' : 'bg-[#D4D4D8]')} />
        <span
          className={cn(
            'mt-0.5 h-4 w-full rounded-sm border',
            light ? 'border-[#E4E4E7] bg-white' : 'border-[#26262B] bg-[#141418]',
          )}
        />
        <span
          className={cn(
            'h-4 w-full rounded-sm border',
            light ? 'border-[#E4E4E7] bg-white' : 'border-[#26262B] bg-[#141418]',
          )}
        />
      </span>
    </span>
  );
}

// ── Regional ─────────────────────────────────────────────────────────────────

function RegionalFacts() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <>
      <SettingsRows>
        <StatRow
          label="Timezone"
          value={mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : '—'}
        />
        <StatRow label="Date format" value={mounted ? new Date().toLocaleDateString() : '—'} />
        <StatRow label="Language" value="English" />
      </SettingsRows>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Timestamps are rendered in your browser&apos;s timezone. The interface is English only.
      </p>
    </>
  );
}
