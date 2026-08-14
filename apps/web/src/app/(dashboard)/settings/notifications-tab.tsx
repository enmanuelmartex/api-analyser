'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconAlertTriangle,
  IconBell,
  IconVolume,
  IconInfoCircle,
} from '@tabler/icons-react';
import { notificationsApi, settingsApi } from '@/lib/api';
import type { NotificationPreferences, SettingValue } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { playNotificationSound } from '@/lib/notification-sound';
import {
  SettingRowsSkeleton,
  SettingsNote,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
  SwitchRow,
} from './_components/settings-primitives';
import { RecipientsField } from './_components/recipients-field';

/**
 * Which switch controls what, and how it is described.
 *
 * A table rather than inline JSX so the groups render identically and adding an
 * event type is one entry rather than a new block of markup.
 */
interface PreferenceGroup {
  title: string;
  description: string;
  items: {
    key: keyof NotificationPreferences;
    label: string;
    description: string;
  }[];
}

/**
 * The events that can be emailed.
 *
 * Deliberately a shorter list than the in-app one. An email cannot be marked
 * read and arrives while the recipient is doing something else, so it is offered
 * only for outcomes somebody is waiting for, failures that stop work, and
 * critical vulnerabilities. Routine findings stay in-app — this mirrors
 * `emailPreference: null` in the backend's notification catalog, which is what
 * actually enforces it.
 */
const EMAIL_ITEMS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  {
    key: 'emailScanCompleted',
    label: 'Scan completed',
    description: 'The scan summary, with the PDF report attached once it has been generated.',
  },
  {
    key: 'emailReportGenerated',
    label: 'Report ready',
    description:
      'Sent with the scan summary above — one email per scan, never one for each.',
  },
  {
    key: 'emailScanFailed',
    label: 'Scan failed',
    description: 'When an assessment does not complete. No report is generated for a failed run.',
  },
  {
    key: 'emailCriticalFinding',
    label: 'Critical findings',
    description:
      'Only sent on its own if you have muted scan-completed emails — otherwise the breakdown is already in that email.',
  },
];

const GROUPS: PreferenceGroup[] = [
  {
    title: 'Scans',
    description: 'Security assessments you started.',
    items: [
      {
        key: 'scanCompleted',
        label: 'Scan completed',
        description: 'When an assessment finishes successfully.',
      },
      {
        key: 'scanFailed',
        label: 'Scan failed',
        description: 'When an assessment fails or is cancelled by an error.',
      },
    ],
  },
  {
    title: 'Reports',
    description: 'Generated documents.',
    items: [
      {
        key: 'reportGenerated',
        label: 'Report ready',
        description:
          'When the PDF for a completed scan has finished generating and can be downloaded.',
      },
      {
        key: 'reportFailed',
        label: 'Report generation failed',
        description:
          'When a report could not be produced after every automatic retry.',
      },
    ],
  },
  {
    title: 'Issues',
    description: 'What your scans find.',
    items: [
      {
        key: 'newFindings',
        label: 'New issues detected',
        description:
          'One grouped notification per scan with the severity breakdown — never one per finding.',
      },
      {
        key: 'criticalFinding',
        label: 'Critical findings',
        description: 'A separate, higher-priority notification when a scan detects a critical vulnerability.',
      },
    ],
  },
  {
    title: 'Security',
    description: 'Platform security events.',
    items: [
      {
        key: 'securityWarning',
        label: 'Security warnings',
        description: 'Platform security events an administrator should review.',
      },
    ],
  },
  {
    title: 'System',
    description: 'Faults in the API and workers.',
    items: [
      {
        key: 'systemError',
        label: 'System errors',
        description: 'Backend or worker failures that need attention.',
      },
    ],
  },
];

/**
 * Settings → Notifications.
 *
 * Previously a list of five switches over `useState` that raised a "preference
 * updated" toast and persisted nothing — and behind them, no notification
 * system at all. Every switch here writes to `notification_preferences` and is
 * consulted by NotificationsService before a notification is created.
 *
 * Each toggle saves on its own rather than behind a "Save" button: there is no
 * valid intermediate state to protect, and a settings screen with unsaved
 * changes is the other common way these end up not persisting.
 */
export function NotificationsTab({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();

  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsApi.preferences,
    staleTime: 60_000,
  });

  // Only to tell the user when the operator's master switch is off, so their
  // own switches are not silently ineffective. Admin-only endpoint.
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.list,
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const notificationsEnabled =
    settings.data?.find((setting) => setting.key === 'notifications.enabled')?.value ?? true;

  const save = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      notificationsApi.updatePreferences(patch),
    // Optimistic: a switch that waits for a round trip before moving feels
    // broken. Rolled back on failure so the control never lies about what was
    // stored.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] });
      const previous = queryClient.getQueryData<NotificationPreferences>([
        'notification-preferences',
      ]);
      if (previous) {
        queryClient.setQueryData(['notification-preferences'], { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (err: any, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notification-preferences'], context.previous);
      }
      toast.error('Could not save preference', {
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  function update(key: keyof NotificationPreferences, value: boolean) {
    save.mutate({ [key]: value } as Partial<NotificationPreferences>);
  }

  /**
   * Turning desktop notifications on has to ask the browser as well.
   *
   * The permission prompt only appears in response to a user gesture, so it is
   * requested here rather than on mount. A denied prompt reverts the switch —
   * leaving it on would promise a notification that can never be delivered.
   */
  async function toggleDesktop(next: boolean) {
    if (!next) {
      update('desktopEnabled', false);
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast.error('Not supported', {
        description: 'This browser does not support desktop notifications.',
      });
      return;
    }

    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission !== 'granted') {
      toast.error('Permission denied', {
        description:
          'Your browser blocked desktop notifications. Allow them in the site settings to enable this.',
      });
      return;
    }

    update('desktopEnabled', true);
  }

  if (preferences.isError) {
    return (
      <SettingsPanel>
        <SettingsSection title="Notifications" description="Choose which events should notify you.">
          <Alert variant="destructive">
            <IconAlertTriangle />
            <div className="flex-1">
              <AlertDescription>Could not load your notification preferences.</AlertDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => preferences.refetch()}
              >
                Retry
              </Button>
            </div>
          </Alert>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  const values = preferences.data;
  const loading = preferences.isLoading;

  return (
    <div className="space-y-5">
      {isAdmin && notificationsEnabled === false && (
        <Alert variant="warning">
          <IconInfoCircle />
          <AlertDescription>
            In-app notifications are switched off platform-wide in{' '}
            <span className="font-medium text-foreground">Configuration → Notifications</span>. No
            notification is created for anyone until that is re-enabled, whatever these switches
            say.
          </AlertDescription>
        </Alert>
      )}

      <SettingsPanel>
        {GROUPS.map((group) => (
          <SettingsSection key={group.title} title={group.title} description={group.description}>
            {loading ? (
              <SettingRowsSkeleton count={group.items.length} />
            ) : (
              <SettingsRows>
                {group.items.map((item) => (
                  <SwitchRow
                    key={item.key}
                    id={`pref-${item.key}`}
                    label={item.label}
                    description={item.description}
                    checked={Boolean(values?.[item.key])}
                    onCheckedChange={(next) => update(item.key, next)}
                  />
                ))}
              </SettingsRows>
            )}
          </SettingsSection>
        ))}

        {/*
         * Administrator-only, and placed above the personal switches on
         * purpose: it is the setting most people come to this screen for, and
         * it governs a different audience entirely. See ReportRecipientsSection.
         */}
        {isAdmin && <ReportRecipientsSection />}

        <SettingsSection
          title="Your email"
          description="Sent to your own account address. Independent of the report recipients above — these switches govern only what you receive."
        >
          {loading ? (
            <SettingRowsSkeleton count={5} />
          ) : (
            <SettingsRows>
              <SwitchRow
                id="pref-email-enabled"
                label="Email notifications"
                description="The master switch. Off by default — a self-hosted install has no mail provider until an administrator configures one."
                hint="If the server has no mail transport configured — neither MAIL_RELAY_URL/MAIL_RELAY_TOKEN nor RESEND_API_KEY — messages are recorded as skipped rather than queued, and your in-app notifications are unaffected."
                checked={Boolean(values?.emailEnabled)}
                onCheckedChange={(next) => update('emailEnabled', next)}
              />

              {/*
               * The per-event switches stay visible but disabled when the master
               * is off, rather than disappearing. Hiding them would make the
               * screen appear to lose settings the user had chosen, and they are
               * still stored — turning the master back on restores exactly the
               * selection that was there before.
               */}
              {EMAIL_ITEMS.map((item) => (
                <SwitchRow
                  key={item.key}
                  id={`pref-${item.key}`}
                  label={item.label}
                  description={item.description}
                  checked={Boolean(values?.emailEnabled) && Boolean(values?.[item.key])}
                  disabled={!values?.emailEnabled}
                  onCheckedChange={(next) => update(item.key, next)}
                />
              ))}
            </SettingsRows>
          )}
        </SettingsSection>

        <SettingsSection
          title="Delivery"
          description="How notifications reach you once they are created."
        >
          {loading ? (
            <SettingRowsSkeleton count={2} />
          ) : (
            <SettingsRows>
              <SwitchRow
                id="pref-sound"
                label="Notification sound"
                description="Play a short tone for scan results, ready reports and critical errors."
                hint="Browsers block audio until you have interacted with the page. The first sound may not play if the tab has just loaded — this is a browser policy and is not worked around."
                checked={Boolean(values?.soundEnabled)}
                onCheckedChange={(next) => {
                  update('soundEnabled', next);
                  // Play once on enable, both as confirmation and because it is
                  // a user gesture — which is what unlocks audio for the
                  // session.
                  if (next) void playNotificationSound();
                }}
                badge={
                  values?.soundEnabled ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                      onClick={() => void playNotificationSound()}
                    >
                      <IconVolume className="h-3.5 w-3.5" />
                      Test
                    </Button>
                  ) : null
                }
              />
              <SwitchRow
                id="pref-desktop"
                label="Desktop notifications"
                description="Show a system notification when the tab is in the background."
                checked={Boolean(values?.desktopEnabled)}
                onCheckedChange={toggleDesktop}
                badge={<DesktopPermissionBadge />}
              />
            </SettingsRows>
          )}
        </SettingsSection>
      </SettingsPanel>

      <SettingsNote icon={IconBell}>
        In-app notifications are always available and are stored in the database, so anything that
        happened while you were away is waiting when you return. Email is optional and requires an
        administrator to configure a Resend API key on the server; without one, no message is sent
        and nothing else changes. There are no webhooks.
      </SettingsNote>
    </div>
  );
}

/** Surfaces the browser's own permission state, which the switch cannot override. */
function DesktopPermissionBadge() {
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>('default');

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
  }, []);

  if (permission === 'denied') {
    return (
      <Badge variant="destructive-light" className="h-5 px-1.5 text-[10px]">
        Blocked by browser
      </Badge>
    );
  }
  if (permission === 'unsupported') {
    return (
      <Badge variant="neutral" className="h-5 px-1.5 text-[10px]">
        Unsupported
      </Badge>
    );
  }
  return null;
}

/**
 * Where scan results are emailed, for the whole installation.
 *
 * The distinction this section has to make legible, because getting it wrong
 * means either a security report going somewhere it should not or a report
 * nobody receives:
 *
 *   • **These addresses** belong to the installation. They are usually a team
 *     mailbox or a ticketing inbox, frequently not users at all, and an
 *     administrator controls them. They receive the report for every scan.
 *   • **The switches below** belong to whoever is reading the screen, and
 *     govern only the mail sent to their own account address.
 *
 * Saves on change rather than behind a Save button, like the rest of Settings:
 * there is no valid intermediate state to protect, and a settings screen with
 * unsaved changes is the other common way these end up not persisting.
 */
function ReportRecipientsSection() {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.list,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, SettingValue>) => settingsApi.update(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (err: any) =>
      toast.error('Could not save', {
        // The API names the offending address, which is the difference between
        // a usable error and "invalid value".
        description: err?.response?.data?.message ?? 'The API rejected the change.',
      }),
  });

  const setting = (key: string) => settings.data?.find((entry) => entry.key === key);

  const recipients = setting('notifications.reportRecipients');
  const onCompleted = setting('notifications.emailOnScanCompleted');
  const onFailed = setting('notifications.emailOnScanFailed');

  const addresses = Array.isArray(recipients?.value) ? (recipients.value as string[]) : [];

  return (
    <SettingsSection
      title="Report recipients"
      description="Addresses that receive the security report for every completed scan, manual or scheduled. They do not need to be users of this installation."
    >
      {settings.isLoading ? (
        <SettingRowsSkeleton count={3} />
      ) : (
        <div className="space-y-5">
          <RecipientsField
            value={addresses}
            max={recipients?.maxItems}
            disabled={save.isPending}
            inputId="report-recipients"
            emptyHint="No addresses yet — reports are only emailed to users who have enabled it for themselves."
            onChange={(next) => save.mutate({ 'notifications.reportRecipients': next })}
          />

          <SettingsRows>
            <SwitchRow
              id="setting-email-on-scan-completed"
              label="Email completed scans"
              description="Send the report to the addresses above when a scan finishes."
              checked={onCompleted?.value !== false}
              disabled={save.isPending}
              onCheckedChange={(next) =>
                save.mutate({ 'notifications.emailOnScanCompleted': next })
              }
            />
            <SwitchRow
              id="setting-email-on-scan-failed"
              label="Email failed scans"
              description="Tell those addresses when a scan does not complete. A failed scheduled scan is easy to miss otherwise."
              checked={onFailed?.value !== false}
              disabled={save.isPending}
              onCheckedChange={(next) => save.mutate({ 'notifications.emailOnScanFailed': next })}
            />
          </SettingsRows>

          <SettingsNote icon={IconInfoCircle}>
            A report over the attachment limit is linked rather than attached, and the email says
            so. Addresses here receive mail regardless of any individual user&rsquo;s notification
            preferences.
          </SettingsNote>
        </div>
      )}
    </SettingsSection>
  );
}
