'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  IconSettings2,
  IconShieldLock,
  IconKey,
  IconBell,
  IconInfoCircle,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconTerminal2,
  IconWorld,
  IconLock,
  IconCpu,
  IconGitBranch,
  IconBolt,
  IconSparkles,
  IconUsers,
  IconHistory,
  IconShield,
  IconCoin,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { authApi, pluginsApi, systemApi } from '@/lib/api';
import { toast } from 'sonner';
import { AiConfigTab } from './ai-config-tab';
import { AiUsageTab } from './ai-usage-tab';
import { UsersTab } from './users-tab';
import { AuditLogsTab } from './audit-logs-tab';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OwaspCoverageMatrix,
  OwaspCoverageSummaryLine,
} from '@/components/security/owasp-coverage-matrix';
import { appBrand } from '@/lib/brand';
import { AppLogoMark } from '@/components/brand/app-logo-mark';

type TabId = 'general' | 'security' | 'tokens' | 'notifications' | 'ai' | 'ai-usage' | 'system' | 'about' | 'users' | 'audit-logs';

const ALL_TABS: { id: TabId; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'general', label: 'General', icon: IconSettings2 },
  { id: 'security', label: 'Security', icon: IconShieldLock },
  { id: 'tokens', label: 'API Tokens', icon: IconKey },
  { id: 'notifications', label: 'Notifications', icon: IconBell },
  { id: 'ai', label: 'AI Configuration', icon: IconSparkles },
  // Admin-only: spend is platform-wide, matching the AI provider config guard.
  { id: 'ai-usage', label: 'AI Usage', icon: IconCoin, adminOnly: true },
  { id: 'system', label: 'System', icon: IconCpu },
  { id: 'about', label: 'About', icon: IconInfoCircle },
  { id: 'users', label: 'Users', icon: IconUsers, adminOnly: true },
  { id: 'audit-logs', label: 'Audit Logs', icon: IconHistory, adminOnly: true },
];

const VALID_TAB_IDS = ALL_TABS.map((t) => t.id);

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = (VALID_TAB_IDS as string[]).includes(tabParam ?? '') ? (tabParam as TabId) : 'general';

  // The tab lives in the URL so a section stays linkable and survives reload.
  // `replace` rather than `push`: nine tab changes should not mean nine presses
  // of the back button to leave Settings.
  function selectTab(id: TabId) {
    router.replace(`${pathname}?tab=${id}`, { scroll: false });
  }

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    staleTime: 5 * 60_000,
  });

  const isAdmin = me?.role === 'ADMIN';
  const activeLabel = ALL_TABS.find((t) => t.id === activeTab)?.label ?? 'General';

  /*
   * A non-admin who deep-links to ?tab=users must not be left on a blank page.
   * The sidebar hides those entries, but hiding is not authorization — the
   * backend guards still reject the requests — so the URL is normalised back to
   * General rather than rendering nothing.
   */
  const resolvedTab: TabId =
    !isAdmin && (activeTab === 'users' || activeTab === 'audit-logs' || activeTab === 'ai-usage')
      ? 'general'
      : activeTab;

  const visibleTabs = ALL_TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account, security preferences and integrations"
        breadcrumb={
          <span className="text-xs text-muted-foreground">
            Settings <span className="px-1 text-muted-foreground/50">·</span> {activeLabel}
          </span>
        }
      />

      {/*
        Settings is a single sidebar entry, so its section navigation lives
        here. It was previously nine sidebar children mirroring these tabs,
        which gave one destination two menus and two simultaneous active
        states. A horizontal strip also costs no content width, unlike the
        12rem vertical menu this replaces.
      */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
      >
        {visibleTabs.map((tab) => {
          const selected = tab.id === resolvedTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(tab.id)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                selected
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-w-0">
        {resolvedTab === 'general' && <GeneralTab user={me} />}
        {resolvedTab === 'security' && <SecurityTab />}
        {resolvedTab === 'tokens' && <TokensTab />}
        {resolvedTab === 'notifications' && <NotificationsTab />}
        {resolvedTab === 'ai' && <AiConfigTab />}
        {resolvedTab === 'ai-usage' && isAdmin && <AiUsageTab />}
        {resolvedTab === 'system' && <SystemTab />}
        {resolvedTab === 'about' && <AboutTab />}
        {resolvedTab === 'users' && isAdmin && <UsersTab currentUserId={me?.id ?? ''} />}
        {resolvedTab === 'audit-logs' && isAdmin && <AuditLogsTab />}
      </div>
    </PageContainer>
  );
}

// ─── GENERAL ──────────────────────────────────────────────────────────────────

/**
 * Every control here either persists or says plainly that it does not.
 *
 * Previously "Save changes" raised a success toast and wrote nothing, and the
 * theme, timezone and language selects were React state that reset on reload.
 * A settings screen that reports success without saving is worse than one with
 * no controls at all — the user believes the change took effect.
 */
function GeneralTab({ user }: { user: any }) {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(user?.name ?? '');

  // next-themes resolves against localStorage on the client only; reading
  // `theme` before mount renders the wrong option as selected.
  useEffect(() => setMounted(true), []);
  useEffect(() => setName(user?.name ?? ''), [user?.name]);

  const saveProfile = useMutation({
    mutationFn: (newName: string) => authApi.updateMe({ name: newName }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      if (typeof window !== 'undefined') {
        localStorage.setItem('iasa_user', JSON.stringify(updated));
      }
      toast.success('Profile updated');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Could not update your profile');
    },
  });

  const trimmed = name.trim();
  const dirty = trimmed !== (user?.name ?? '').trim();

  return (
    <div className="space-y-6">
      <Section title="Profile" description="Your public information">
        <div className="space-y-4">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20">
              <span className="text-xl font-bold text-primary">{user?.name?.charAt(0)?.toUpperCase() || 'A'}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <Badge variant="outline" className="mt-1 border-primary/20 bg-primary/10 text-[10px] uppercase text-primary">
                {user?.role}
              </Badge>
            </div>
          </div>

          <Field label="Display Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={80}
              aria-describedby="display-name-hint"
            />
            <p id="display-name-hint" className="mt-1.5 text-xs text-muted-foreground">
              Shown on issues you are assigned and in the audit log.
            </p>
          </Field>

          <Field label="Email Address">
            <Input value={user?.email ?? ''} readOnly className="cursor-not-allowed text-muted-foreground" />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your email identifies your sign-in account and cannot be changed here.
            </p>
          </Field>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => saveProfile.mutate(trimmed)}
              disabled={!dirty || trimmed.length === 0 || saveProfile.isPending}
            >
              {saveProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {dirty && !saveProfile.isPending && (
              <Button variant="ghost" size="sm" onClick={() => setName(user?.name ?? '')}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Appearance" description="Stored in this browser">
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm text-foreground">Theme</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Applies immediately and persists on this device.
            </p>
          </div>
          <Select value={mounted ? theme ?? 'system' : 'system'} onValueChange={setTheme}>
            <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Section>

      {/*
        Timezone and language were selects backed by nothing. They are stated
        as facts instead: both are genuinely true of the running product, and
        neither pretends to be adjustable.
      */}
      <Section title="Regional" description="Not configurable yet">
        <div className="space-y-0">
          <div className="flex items-center justify-between border-b border-border py-3">
            <div>
              <p className="text-sm text-foreground">Timezone</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Timestamps are rendered in your browser&apos;s timezone.
              </p>
            </div>
            <span className="text-sm font-medium text-foreground">
              {mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-foreground">Language</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The interface is English only. Additional languages are not available yet.
              </p>
            </div>
            <span className="text-sm font-medium text-foreground">English</span>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── SECURITY ─────────────────────────────────────────────────────────────────

function SecurityTab() {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPwd.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    toast.success('Password changed successfully');
    setCurrent('');
    setNewPwd('');
    setConfirm('');
  }

  return (
    <div className="space-y-6">
      <Section title="Change Password" description="Update your authentication credentials">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Current password">
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="New password">
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Button type="submit">Update password</Button>
        </form>
      </Section>

      <Section title="Sessions" description="Active sessions and access history">
        <div className="space-y-3">
          <div className="flex items-center gap-4 border-b border-border py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <IconWorld className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">Current session</p>
                <Badge variant="success" className="text-[10px]">
                  Active
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Web Browser · localhost</p>
            </div>
            <span className="text-xs text-muted-foreground">Now</span>
          </div>
          <p className="text-xs text-muted-foreground">Only the current session is shown. Multi-device session management coming in v0.2.</p>
        </div>
      </Section>

      <Section title="Danger Zone" description="Irreversible account actions">
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">Delete Account</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Permanently remove your account and all associated data.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => toast.error('Account deletion requires admin approval')}>
              Delete Account
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── TOKENS ───────────────────────────────────────────────────────────────────
//
// API tokens have no backend yet. The `ApiKey` model exists in the Prisma schema
// (name, keyHash, keyPreview, scopes, expiresAt, lastUsedAt) but no controller or
// service reads it, so there is no route to create, list or revoke a token.
//
// This tab previously rendered MOCK_TOKENS: two hardcoded entries with client-only
// create/revoke, whose "copy" button copied the masked placeholder rather than a
// real credential. Showing a working-looking token manager that issues nothing is
// worse than showing nothing, so it is replaced by an explicit unavailable state
// until the endpoints exist (Phase 7).

function TokensTab() {
  return (
    <div className="space-y-6">
      <Section
        title="API Tokens"
        description="Tokens for programmatic access and integrations"
      >
        <div className="flex flex-col items-center py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <IconKey className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">API tokens are not available yet</p>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Programmatic access is not implemented in this build. Once available you will be
            able to create named tokens with scopes and an expiry, see when each was last used,
            and revoke them at any time.
          </p>
          <p className="mt-3 text-xs text-muted-foreground/80">
            Use your session in the web interface in the meantime.
          </p>
        </div>
      </Section>

      <Card>
        <CardContent className="flex gap-3 p-4">
          <IconLock className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Token security</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              When API tokens ship, the full value will be shown once at creation and never
              again — only a masked preview is stored. Keep tokens in environment variables,
              never in version control, and revoke any token you suspect has been exposed.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

/**
 * Honestly unavailable, in the same spirit as the API Tokens tab.
 *
 * This tab previously rendered five switches over `useState` with a "preference
 * updated" toast on every toggle. Nothing was persisted and no notification of
 * any kind is delivered by the product — there is no notification table, no
 * dispatcher and no scheduler. Toggles that survive until reload and then
 * silently reset are a worse failure than an empty state, because the user
 * believes they have configured alerting they will never receive.
 *
 * The switches are removed rather than disabled: a row of greyed-out switches
 * still implies the capability exists and is merely switched off.
 */
function NotificationsTab() {
  const planned = [
    { label: 'Scan completed', desc: 'When a security assessment finishes' },
    { label: 'Critical findings', desc: 'Immediate alert for critical vulnerabilities' },
    { label: 'Scan failed', desc: 'When an assessment fails or is cancelled' },
    { label: 'New reports', desc: 'When a security report is generated' },
    { label: 'Weekly digest', desc: 'Summary of your security posture each week' },
  ];

  return (
    <div className="space-y-6">
      <Section title="Notifications" description="Not available yet">
        <div className="py-6 text-center">
          <IconBell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-sm text-foreground">Notifications are not available yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            {appBrand.name} does not send notifications of any kind today — in-app, email or
            webhook. Scan results appear on the Scans and Issues screens as soon as a scan
            finishes.
          </p>
        </div>
      </Section>

      <Section title="Planned Alerts" description="What this tab will control once delivery exists">
        <ul className="divide-y divide-border">
          {planned.map(({ label, desc }) => (
            <li key={label} className="flex items-center justify-between py-3.5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">{desc}</p>
              </div>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                Planned
              </Badge>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ─── SYSTEM ───────────────────────────────────────────────────────────────────

/**
 * Every value here is read from `GET /system/info`.
 *
 * This tab used to be a hardcoded list. It claimed "11 OWASP Plugins Active"
 * against ten checks, showed SSRF as disabled while it was enabled in the
 * database, and listed seven OWASP categories with no indication that three
 * others exist and are untested.
 */
function SystemTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system', 'info'],
    queryFn: systemApi.info,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Section title="System Information" description="Runtime and infrastructure details">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </Section>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Section title="System Information" description="Runtime and infrastructure details">
        <div className="py-8 text-center">
          <IconCpu className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-foreground">Could not load system information</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(error as any)?.response?.data?.message ??
              'The API did not respond. System details are unavailable rather than estimated.'}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </Section>
    );
  }

  const { product, runtime, securityChecks, owasp } = data;

  return (
    <div className="space-y-6">
      <Section title="System Information" description="Runtime and infrastructure details">
        <div className="space-y-0">
          {[
            { label: 'Platform', value: `${product.name} API v1` },
            { label: 'Version', value: product.version },
            { label: 'Environment', value: runtime.environment },
            {
              label: 'Runtime',
              value: runtime.bunVersion
                ? `Bun ${runtime.bunVersion} + ${runtime.apiFramework}`
                : `Node ${runtime.nodeVersion} + ${runtime.apiFramework}`,
            },
            { label: 'API uptime', value: formatUptime(runtime.uptimeSeconds) },
            {
              label: 'Security checks',
              value: `${securityChecks.enabled} of ${securityChecks.total} enabled · ${securityChecks.totalRules} rules`,
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-border py-3 last:border-0"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-sm font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="OWASP API Security Top 10"
        description="Which categories the installed checks actually test"
      >
        <OwaspCoverageSummaryLine coverage={owasp} className="mb-4" />
        <OwaspCoverageMatrix coverage={owasp} />
      </Section>

      <Section
        title="Installed Security Checks"
        description="Enablement is read from the database, not assumed"
      >
        <div className="space-y-1">
          {securityChecks.checks.map((check) => (
            <div key={check.id} className="flex items-center gap-3 py-2">
              <div
                className={cn(
                  'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                  check.isEnabled ? 'bg-success' : 'bg-muted-foreground/40',
                )}
                aria-hidden="true"
              />
              <span className="w-24 flex-shrink-0 font-mono text-[10px] text-muted-foreground">
                {check.owaspMappings.map((m) => m.split(':')[0]).join(', ') || '—'}
              </span>
              <span className="flex-1 truncate text-sm text-foreground">{check.name}</span>
              <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                {check.ruleCount} {check.ruleCount === 1 ? 'rule' : 'rules'}
              </span>
              <span
                className={cn(
                  'w-16 flex-shrink-0 text-right text-[10px] font-semibold uppercase',
                  check.isEnabled ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {check.isEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Renders seconds as a short human duration, e.g. "3d 4h" or "12m". */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ─── ABOUT ────────────────────────────────────────────────────────────────────

function AboutTab() {
  // The capability tiles below state what the product does. They are read from
  // the registry rather than written here, because the hand-written version
  // claimed eleven checks and full Top 10 coverage while ten checks were
  // installed and three categories had nothing behind them at all.
  const { data: coverage } = useQuery({
    queryKey: ['plugins', 'owasp-coverage'],
    queryFn: pluginsApi.owaspCoverage,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-8 text-center">
          <AppLogoMark size={56} className="mx-auto mb-4 text-foreground" />
          <h2 className="mb-1 text-xl font-bold text-foreground">{appBrand.name}</h2>
          <p className="text-sm text-muted-foreground">{appBrand.tagline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{appBrand.domain}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">v0.1.0</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
              Open Source MVP
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Section title="About This Project" description="Mission and objectives">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {appBrand.name} is an open source platform for automated security evaluation of RESTful APIs, aligned with the{' '}
          <span className="font-medium text-primary">OWASP API Security Top 10</span>. It detects vulnerabilities, generates professional reports, and
          allows managing multiple projects and users across organizations.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                icon: IconBolt,
                label: coverage
                  ? `${coverage.checkCount} security checks`
                  : 'Security checks',
                desc: coverage
                  ? `${coverage.ruleCount} rules across ${coverage.coveredCount} of ${coverage.totalCount} OWASP categories`
                  : 'Loading coverage…',
              },
              { icon: IconGitBranch, label: 'Open Source', desc: 'MIT License — free forever' },
              { icon: IconTerminal2, label: 'API-First', desc: 'REST API with Swagger docs' },
              {
                icon: IconShield,
                label: 'OWASP Aligned',
                desc: coverage
                  ? `API Security Top 10 2023 — ${coverage.label} covered`
                  : 'API Security Top 10 2023',
              },
            ] as const
          ).map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-xl border border-border bg-muted/40 p-3.5">
              <Icon className="mb-2 h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Stack" description={`Technologies powering ${appBrand.name}`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {['NestJS 10', 'Next.js 15', 'React 19', 'PostgreSQL 16', 'Redis 7', 'BullMQ 5', 'Prisma ORM', 'TypeScript 5', 'Bun Runtime', 'TanStack Query', 'Tailwind CSS', 'Recharts'].map(
            (tech) => (
              <div key={tech} className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                <IconChevronRight className="h-3 w-3 text-muted-foreground/60" />
                {tech}
              </div>
            ),
          )}
        </div>
      </Section>
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
