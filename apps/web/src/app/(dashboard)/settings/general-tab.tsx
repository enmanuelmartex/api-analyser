'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { IconCheck, IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { authApi } from '@/lib/api';
import { AVATAR_COLORS, UserAvatar, userInitials } from '@/components/shared/user-avatar';
import { TimezoneSelect } from '@/components/scheduled-scans/timezone-select';
import { useDateFormat } from '@/hooks/use-user-preferences';
import {
  DATE_FORMAT_OPTIONS,
  SAMPLE_INSTANT,
  TIME_FORMAT_OPTIONS,
  detectTimeZone,
  effectiveTimeZone,
  formatDay,
  formatTimeOfDay,
  normalisePreferences,
  type DateFormatKey,
  type TimeFormatKey,
  type UserPreferences,
} from '@/lib/user-preferences';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FieldRow,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
} from './_components/settings-primitives';

/**
 * Settings → General.
 *
 * Every control here persists. The Regional block in particular used to be a
 * pair of read-only rows under the heading "Not configurable in this build" —
 * an honest description of selects that had been backed by React state and
 * reset on reload. They are now real: the timezone and the date and time
 * formats live on the account, travel with `GET /auth/me`, and drive every
 * timestamp the product renders through `lib/user-preferences`.
 */
export function GeneralTab({ user }: { user: any }) {
  return (
    <div className="space-y-5">
      <SettingsPanel>
        <ProfileSection user={user} />

        <SettingsSection
          title="Appearance"
          description="Stored in this browser, not on your account. Applies immediately."
        >
          <ThemePicker />
        </SettingsSection>

        <RegionalSection user={user} />
      </SettingsPanel>
    </div>
  );
}

/**
 * Saves a partial profile patch and republishes the result.
 *
 * Shared by both forms below rather than written twice, because getting the
 * aftermath right matters more than the request: `['me']` is what
 * `DashboardShell` reads to feed the preferences store, and
 * `api_analyser_user` is what the sidebar falls back to on the next cold load.
 * Updating one and not the other is how a saved preference appears to revert
 * on refresh.
 */
function useProfileMutation(successMessage: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Parameters<typeof authApi.updateMe>[0]) => authApi.updateMe(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
      if (typeof window !== 'undefined') {
        localStorage.setItem('api_analyser_user', JSON.stringify(updated));
      }
      /*
       * Everything, not just `['me']`.
       *
       * A date already on screen was rendered by a component that read the
       * preferences store without subscribing to it — which is the deliberate
       * trade that lets fifteen call sites keep saying `formatDate(x)`. Their
       * data comes from queries, so refetching is what re-renders them, and a
       * settings save is exactly the moment where that cost is invisible.
       */
      queryClient.invalidateQueries();
      toast.success(successMessage);
    },
    onError: (err: any) =>
      toast.error('Could not update your profile', {
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      }),
  });
}

// ── Profile ──────────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: any }) {
  const save = useProfileMutation('Profile updated');

  const [name, setName] = React.useState(user?.name ?? '');
  const [colour, setColour] = React.useState<string>(user?.avatarColor ?? 'default');

  // Re-seeded whenever the server's copy changes, which includes the response
  // to our own save — so a successful write leaves the form clean rather than
  // permanently dirty against a stale baseline.
  React.useEffect(() => setName(user?.name ?? ''), [user?.name]);
  React.useEffect(() => setColour(user?.avatarColor ?? 'default'), [user?.avatarColor]);

  const trimmed = name.trim();
  const savedColour = user?.avatarColor ?? 'default';
  const dirty = trimmed !== (user?.name ?? '').trim() || colour !== savedColour;

  function reset() {
    setName(user?.name ?? '');
    setColour(savedColour);
  }

  return (
    <SettingsSection
      title="Profile"
      description="Shown on issues you are assigned and in the audit log."
    >
      {/*
        The preview is the live draft, not the saved record: picking a colour
        below repaints this immediately, which is the entire point of showing an
        avatar on a screen that has no avatar upload.
      */}
      <div className="mb-1 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <UserAvatar
          name={trimmed || user?.name}
          color={colour}
          className="h-10 w-10"
          fallbackClassName="text-sm font-semibold"
        />
        <div className="min-w-0 flex-1">
          {user ? (
            <>
              <p className="truncate text-sm font-medium text-foreground">
                {trimmed || user.name}
              </p>
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

      <AvatarColorPicker
        value={colour}
        onChange={setColour}
        name={trimmed || user?.name}
        disabled={!user}
      />

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
        {dirty && !save.isPending && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => save.mutate({ name: trimmed, avatarColor: colour })}
          disabled={!dirty || trimmed.length === 0}
          loading={save.isPending}
        >
          Save changes
        </Button>
      </div>
    </SettingsSection>
  );
}

/**
 * The avatar background, as twelve swatches.
 *
 * A colour picker rather than an image upload, and that is a product decision
 * worth stating: storing avatars means object storage, size and content-type
 * limits, and a moderation question — all to answer "which row is mine?", which
 * initials on a colour already answer. So the initials stay generated and the
 * only thing anyone chooses is what sits behind them.
 *
 * Rendered as the real avatar at swatch size rather than as a plain colour
 * chip. The question being asked is "how will my initials look on this?", and
 * a bare square answers a different one — the tint that reads well as a 40px
 * block can be the one your letters disappear into.
 */
function AvatarColorPicker({
  value,
  onChange,
  name,
  disabled,
}: {
  value: string;
  onChange: (_next: string) => void;
  name: string | null | undefined;
  disabled?: boolean;
}) {
  return (
    <fieldset className="mt-4 border-t border-border pt-4" disabled={disabled}>
      <legend className="sr-only">Avatar colour</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <p className="text-sm leading-snug text-foreground">Avatar colour</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Your initials are generated from your display name. Pick the colour behind them —
            there is no image to upload, and none is stored.
          </p>
        </div>

        {/*
          `radiogroup`, not a row of buttons: without it a screen reader
          announces twelve unrelated checkable controls instead of one choice of
          twelve, and arrow keys stop working as a way through them.
        */}
        <div
          role="radiogroup"
          aria-label="Avatar colour"
          className="grid grid-cols-6 gap-2 sm:w-[280px] sm:flex-shrink-0"
        >
          {AVATAR_COLORS.map((option) => {
            const selected = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                title={option.label}
                onClick={() => onChange(option.key)}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full text-[11px] font-semibold transition-shadow',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                  option.fill,
                  selected
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                    : 'hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-card',
                )}
              >
                {userInitials(name)}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
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

/**
 * Timezone, date format and clock — the settings that decide how every
 * timestamp in the product reads.
 *
 * Edited as a draft against a Save button rather than saved per keystroke.
 * Three controls that must agree to make sense together — a zone, a date shape
 * and a clock — are best judged against the sample below them before being
 * committed, and one request beats three when all three usually change at once.
 */
function RegionalSection({ user }: { user: any }) {
  const save = useProfileMutation('Regional settings updated');

  /*
   * The account's saved state. `normalisePreferences` is what turns a null
   * column or a key this build no longer knows into something renderable, so
   * the form and the rest of the app read the record the same way.
   *
   * Memoised on the three fields rather than on `user`, and that is load-bearing
   * rather than an optimisation: `normalisePreferences` returns a fresh object
   * every call, so keying on `user` would hand the effect below a new `saved`
   * on every re-render of this screen — including the one React Query triggers
   * when it refetches `me` on window focus. The draft would be silently reset
   * mid-edit, which reads as the form throwing away a choice for no reason.
   */
  const saved = React.useMemo<UserPreferences>(
    () => normalisePreferences(user),
    [user?.timeZone, user?.dateFormat, user?.timeFormat],
  );

  const [draft, setDraft] = React.useState<UserPreferences>(saved);

  // Re-seeded only when the server's copy actually differs — which includes the
  // response to our own save, so a successful write leaves the form clean.
  React.useEffect(() => setDraft(saved), [saved]);

  const dirty =
    draft.timeZone !== saved.timeZone ||
    draft.dateFormat !== saved.dateFormat ||
    draft.timeFormat !== saved.timeFormat;

  const deviceZone = useDeviceTimeZone();
  const followingDevice = draft.timeZone === null;

  return (
    <SettingsSection
      title="Regional"
      description="Saved to your account, so every device you sign in from renders timestamps the same way."
    >
      <SettingsRows>
        <FieldRow
          label="Timezone"
          htmlFor="pref-timezone"
          hint={
            followingDevice
              ? `Following this device: ${deviceZone ?? '—'}. Pick a zone to pin it instead.`
              : 'Every timestamp in the app is rendered in this zone, on every device.'
          }
        >
          <div className="space-y-1.5">
            <TimezoneSelect
              id="pref-timezone"
              value={draft.timeZone ?? deviceZone ?? 'UTC'}
              onChange={(next) => setDraft((prev) => ({ ...prev, timeZone: next }))}
            />
            {/*
              A way back to "follow the device" — the null state, which the
              combobox itself cannot express because every row in it is a real
              zone. Hidden when it would be a no-op rather than shown disabled;
              a permanently greyed control is noise on a settings row.
            */}
            {!followingDevice && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setDraft((prev) => ({ ...prev, timeZone: null }))}
              >
                Follow this device instead
              </Button>
            )}
          </div>
        </FieldRow>

        <FieldRow
          label="Date format"
          htmlFor="pref-date-format"
          hint="Applies to every date the product renders, including reports and the audit log."
        >
          <Select
            value={draft.dateFormat}
            onValueChange={(next) =>
              setDraft((prev) => ({ ...prev, dateFormat: next as DateFormatKey }))
            }
          >
            <SelectTrigger id="pref-date-format" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMAT_OPTIONS.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {/*
                    The rendered sample leads and the name follows. Nobody
                    chooses "ISO 8601" — they choose the one that reads the way
                    they expect, and the only way to offer that is to show it.
                    Rendered through the very function that will format the app,
                    with the zone currently in the draft, so it cannot drift
                    from what saving actually does.
                  */}
                  <span className="tabular-nums">
                    {formatDay(SAMPLE_INSTANT, { ...draft, dateFormat: option.key })}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Clock" htmlFor="pref-time-format">
          <Select
            value={draft.timeFormat}
            onValueChange={(next) =>
              setDraft((prev) => ({ ...prev, timeFormat: next as TimeFormatKey }))
            }
          >
            <SelectTrigger id="pref-time-format" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_FORMAT_OPTIONS.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <span className="tabular-nums">
                    {formatTimeOfDay(SAMPLE_INSTANT, { ...draft, timeFormat: option.key })}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Language" hint="The interface is English only.">
          <Input value="English" readOnly className="h-9 cursor-not-allowed text-muted-foreground" />
        </FieldRow>
      </SettingsRows>

      <RegionalPreview draft={draft} dirty={dirty} />

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
        {dirty && !save.isPending && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={() =>
            save.mutate({
              // `null` is sent, not omitted: it is what clears a pinned zone
              // back to "follow the device".
              timeZone: draft.timeZone,
              dateFormat: draft.dateFormat,
              timeFormat: draft.timeFormat,
            })
          }
          disabled={!dirty}
          loading={save.isPending}
        >
          Save changes
        </Button>
      </div>
    </SettingsSection>
  );
}

/**
 * What the draft does to a real timestamp, right now.
 *
 * Deliberately "now" and not the fixed sample the selects use: a sample date
 * proves the *shape*, but only the current instant proves the *zone* — a
 * timezone change is invisible until you see a clock that disagrees with the
 * one on your wall.
 */
function RegionalPreview({ draft, dirty }: { draft: UserPreferences; dirty: boolean }) {
  // Subscribes to the store, so the "in effect" line is the truth about what
  // the rest of the app is rendering with — not a copy of the draft.
  const live = useDateFormat();

  const [now, setNow] = React.useState<Date | null>(null);

  /*
   * Mount-gated and then ticking. `null` until mounted because the zone and the
   * clock are both client facts — rendering them during SSR would produce
   * markup the client immediately contradicts. The interval keeps the preview
   * from going stale while somebody sits on this screen deciding.
   */
  React.useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now) return <div className="mt-4 h-[4.5rem] rounded-lg border border-border bg-muted/30" />;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-xs text-muted-foreground">
          {dirty ? 'Right now, once saved' : 'Right now'}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {effectiveTimeZone(draft)}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
        {formatDay(now, draft)}, {formatTimeOfDay(now, draft)}
      </p>
      {dirty && (
        <p className="mt-1 text-xs text-muted-foreground">
          Currently in effect: <span className="tabular-nums">{live.dateTime(now)}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The browser's own zone, read after mount.
 *
 * `null` on the server and on the first client render, for the same reason the
 * preview is gated: `resolvedOptions()` cannot be known during SSR, and a value
 * that appears out of nowhere on hydration is a mismatch.
 */
function useDeviceTimeZone(): string | null {
  const [zone, setZone] = React.useState<string | null>(null);
  React.useEffect(() => setZone(detectTimeZone()), []);
  return zone;
}
