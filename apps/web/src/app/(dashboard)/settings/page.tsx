'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { authApi } from '@/lib/api';
import { toast } from 'sonner';
import { AiConfigTab } from './ai-config-tab';
import { UsersTab } from './users-tab';
import { AuditLogsTab } from './audit-logs-tab';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { appBrand } from '@/lib/brand';
import { AppLogoMark } from '@/components/brand/app-logo-mark';

type TabId = 'general' | 'security' | 'tokens' | 'notifications' | 'ai' | 'system' | 'about' | 'users' | 'audit-logs';

const ALL_TABS: { id: TabId; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'general', label: 'General', icon: IconSettings2 },
  { id: 'security', label: 'Security', icon: IconShieldLock },
  { id: 'tokens', label: 'API Tokens', icon: IconKey },
  { id: 'notifications', label: 'Notifications', icon: IconBell },
  { id: 'ai', label: 'AI Configuration', icon: IconSparkles },
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

  function setActiveTab(id: TabId) {
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
    !isAdmin && (activeTab === 'users' || activeTab === 'audit-logs') ? 'general' : activeTab;

  return (
    <PageContainer>
      {/*
        No in-page navigation.
        Settings used to render its own vertical menu listing the same nine
        entries as the global sidebar, which meant two menus, two simultaneous
        active states, and a 12rem column of duplicated links stealing width
        from the content. The sidebar's Settings group is now the single source
        of navigation; this page renders only the selected section.
      */}
      <PageHeader
        title="Settings"
        description="Manage your account, security preferences and integrations"
        breadcrumb={
          <span className="text-xs text-muted-foreground">
            Settings <span className="px-1 text-muted-foreground/50">·</span> {activeLabel}
          </span>
        }
      />

      <div className="min-w-0">
        {resolvedTab === 'general' && <GeneralTab user={me} />}
        {resolvedTab === 'security' && <SecurityTab />}
        {resolvedTab === 'tokens' && <TokensTab />}
        {resolvedTab === 'notifications' && <NotificationsTab />}
        {resolvedTab === 'ai' && <AiConfigTab />}
        {resolvedTab === 'system' && <SystemTab />}
        {resolvedTab === 'about' && <AboutTab />}
        {resolvedTab === 'users' && isAdmin && <UsersTab currentUserId={me?.id ?? ''} />}
        {resolvedTab === 'audit-logs' && isAdmin && <AuditLogsTab />}
      </div>
    </PageContainer>
  );
}

// ─── GENERAL ──────────────────────────────────────────────────────────────────

function GeneralTab({ user }: { user: any }) {
  const [name, setName] = useState(user?.name ?? '');

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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>

          <Field label="Email Address">
            <Input value={user?.email ?? ''} readOnly className="cursor-not-allowed text-muted-foreground" />
            <p className="mt-1.5 text-xs text-muted-foreground">Email changes require support contact</p>
          </Field>

          <Button onClick={() => toast.success('Profile updated')}>Save changes</Button>
        </div>
      </Section>

      <Section title="Preferences" description="Interface and behavior">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border py-3">
            <div>
              <p className="text-sm text-foreground">Theme</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Application color scheme</p>
            </div>
            <Select defaultValue="dark">
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark (Default)</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between border-b border-border py-3">
            <div>
              <p className="text-sm text-foreground">Timezone</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Used for timestamps and scheduling</p>
            </div>
            <Select defaultValue="UTC">
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'].map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-foreground">Language</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Interface language</p>
            </div>
            <Select defaultValue="en">
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English (Default)</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="pt">Portuguese</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
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

function NotificationsTab() {
  const [prefs, setPrefs] = useState({
    scanComplete: true,
    criticalFindings: true,
    weeklyDigest: false,
    scanFailed: true,
    newReports: false,
  });

  function toggle(key: keyof typeof prefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    toast.success('Notification preference updated');
  }

  const items = [
    { key: 'scanComplete' as const, label: 'Scan completed', desc: 'When a security assessment finishes' },
    { key: 'criticalFindings' as const, label: 'Critical findings', desc: 'Immediate alert for critical vulnerabilities' },
    { key: 'scanFailed' as const, label: 'Scan failed', desc: 'When an assessment fails or is cancelled' },
    { key: 'newReports' as const, label: 'New reports', desc: 'When a new security report is generated' },
    { key: 'weeklyDigest' as const, label: 'Weekly digest', desc: 'Summary of your security posture each week' },
  ];

  return (
    <div className="space-y-6">
      <Section title="In-App Notifications" description={`What you see inside ${appBrand.name}`}>
        <div className="divide-y divide-border">
          {items.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between py-3.5">
              <div>
                <p className="text-sm text-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch checked={prefs[key]} onCheckedChange={() => toggle(key)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Email Notifications" description="Coming in v0.2">
        <div className="py-6 text-center">
          <IconBell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Email notifications are not configured yet</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Configure SMTP settings in the system panel to enable this feature</p>
        </div>
      </Section>
    </div>
  );
}

// ─── SYSTEM ───────────────────────────────────────────────────────────────────

function SystemTab() {
  return (
    <div className="space-y-6">
      <Section title="System Information" description="Runtime and infrastructure details">
        <div className="space-y-0">
          {[
            { label: 'Platform', value: `${appBrand.name} API v1` },
            { label: 'Runtime', value: 'Bun 1.x + NestJS 10' },
            { label: 'Database', value: 'PostgreSQL 16' },
            { label: 'Queue', value: 'Redis 7 + BullMQ 5' },
            { label: 'Frontend', value: 'Next.js 15 + React 19' },
            { label: 'Scanner Plugins', value: '11 OWASP Plugins Active' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between border-b border-border py-3 last:border-0">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-sm font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Scanner Configuration" description="Active security plugins">
        <div className="space-y-2">
          {[
            { id: 'API1:2023', name: 'BOLA — Broken Object Level Authorization', active: true },
            { id: 'API2:2023', name: 'Broken Authentication', active: true },
            { id: 'API3:2023', name: 'Mass Assignment', active: true },
            { id: 'API4:2023', name: 'Unrestricted Resource Consumption', active: true },
            { id: 'API5:2023', name: 'BFLA — Broken Function Level Authorization', active: true },
            { id: 'API7:2023', name: 'Server Side Request Forgery (SSRF)', active: false },
            { id: 'API8:2023', name: 'Security Misconfiguration', active: true },
          ].map(({ id, name, active }) => (
            <div key={id} className="flex items-center gap-3 py-2">
              <div className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', active ? 'bg-success' : 'bg-muted-foreground/40')} />
              <span className="w-20 flex-shrink-0 font-mono text-[10px] text-muted-foreground">{id.split(':')[0]}</span>
              <span className="flex-1 text-sm text-foreground">{name}</span>
              <span className={cn('text-[10px] font-semibold uppercase', active ? 'text-success' : 'text-muted-foreground')}>
                {active ? 'Active' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─── ABOUT ────────────────────────────────────────────────────────────────────

function AboutTab() {
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
              { icon: IconBolt, label: '11 OWASP Plugins', desc: 'Full API Top 10 2023 coverage' },
              { icon: IconGitBranch, label: 'Open Source', desc: 'MIT License — free forever' },
              { icon: IconTerminal2, label: 'API-First', desc: 'REST API with Swagger docs' },
              { icon: IconShield, label: 'OWASP Aligned', desc: 'API Security Top 10 2023' },
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
