'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconEye,
  IconEyeOff,
  IconHistory,
  IconInfoCircle,
  IconShieldCheck,
  IconWorld,
} from '@tabler/icons-react';
import { accountApi } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FieldRow,
  SettingsNote,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
} from './_components/settings-primitives';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Settings → Security.
 *
 * The change-password form used to validate in the browser, raise "Password
 * changed successfully" and send nothing — the user's password was unchanged
 * and they had been told otherwise. It now calls `POST /auth/change-password`,
 * which verifies the current password server-side and updates both credential
 * stores.
 *
 * The "Delete account" button that raised an error toast is gone: there is no
 * self-service account deletion endpoint, so a button that can only ever fail
 * was removed rather than left as decoration in a danger zone.
 *
 * There is deliberately no "Authentication" block of 2FA and SSO switches. This
 * build has neither, and a panel of disabled toggles reads as capability that
 * is merely switched off.
 */
export function SecurityTab() {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNext, setShowNext] = React.useState(false);

  const change = useMutation({
    mutationFn: () => accountApi.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed', {
        description: 'Use your new password the next time you sign in.',
      });
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (err: any) =>
      toast.error('Could not change password', {
        description:
          err?.response?.data?.message ??
          'The API rejected the request. Check your current password.',
      }),
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const sameAsCurrent = next.length > 0 && next === current;
  const valid =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    next !== current;

  return (
    <div className="space-y-5">
      <SettingsPanel>
        <SettingsSection
          title="Password"
          description="You will stay signed in on this device. Other sessions are not revoked."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) change.mutate();
            }}
          >
            <SettingsRows>
              <FieldRow label="Current password" htmlFor="current-password">
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-9 pr-10"
                    required
                  />
                  <RevealButton shown={showCurrent} onToggle={() => setShowCurrent((v) => !v)} />
                </div>
              </FieldRow>

              <FieldRow
                label="New password"
                htmlFor="new-password"
                error={
                  tooShort
                    ? `Must be at least ${MIN_PASSWORD_LENGTH} characters`
                    : sameAsCurrent
                      ? 'Must differ from your current password'
                      : undefined
                }
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              >
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNext ? 'text' : 'password'}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="h-9 pr-10"
                    required
                  />
                  <RevealButton shown={showNext} onToggle={() => setShowNext((v) => !v)} />
                </div>
              </FieldRow>

              <FieldRow
                label="Confirm new password"
                htmlFor="confirm-password"
                error={mismatch ? 'Passwords do not match' : undefined}
              >
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="h-9"
                  required
                />
              </FieldRow>
            </SettingsRows>

            <div className="mt-4 flex justify-end border-t border-border pt-4">
              <Button type="submit" size="sm" disabled={!valid} loading={change.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection title="Sessions" description="Where your account is currently signed in.">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-background">
              <IconWorld className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">This session</p>
                <Badge variant="success-light" className="text-[10px]">
                  Active
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {typeof window !== 'undefined' ? window.location.host : '—'}
              </p>
            </div>
          </div>

          <Alert variant="default" className="mt-3">
            <IconInfoCircle />
            <AlertDescription>
              Only the current session is shown. This build does not track sessions across devices,
              so no other device can be listed or signed out from here.
            </AlertDescription>
          </Alert>
        </SettingsSection>

        <SettingsSection
          title="Account security"
          description="What this instance records about access to your account."
        >
          <SettingsRows>
            <div className="flex items-start gap-3 py-3">
              <IconHistory
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground">Sign-in activity</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Every sign-in, failed attempt and password change is recorded with its IP address
                  and user agent. Administrators can review them under Audit logs.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 py-3">
              <IconShieldCheck
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground">Credential storage</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Passwords are stored hashed and are never rendered, logged or included in an
                  exported audit record.
                </p>
              </div>
            </div>
          </SettingsRows>
        </SettingsSection>
      </SettingsPanel>

      <SettingsNote icon={IconInfoCircle}>
        Two-factor authentication and single sign-on are not implemented in this build. They are
        absent rather than shown as switches that cannot be turned on.
      </SettingsNote>
    </div>
  );
}

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
    >
      {shown ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
    </button>
  );
}
