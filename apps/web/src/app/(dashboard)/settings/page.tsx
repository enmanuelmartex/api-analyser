'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  IconAdjustments,
  IconBell,
  IconCoin,
  IconCpu,
  IconHistory,
  IconInfoCircle,
  IconKey,
  IconSettings2,
  IconShieldLock,
  IconSparkles,
  IconUsers,
} from '@tabler/icons-react';
import { authApi } from '@/lib/api';
import { PageContainer } from '@/components/layout/page-container';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { SettingsNavigation, type SettingsTab } from './_components/settings-nav';
import { GeneralTab } from './general-tab';
import { SecurityTab } from './security-tab';
import { ConfigurationTab } from './configuration-tab';
import { NotificationsTab } from './notifications-tab';
import { TokensTab } from './tokens-tab';
import { SystemTab } from './system-tab';
import { AboutTab } from './about-tab';
import { AiConfigTab } from './ai-config-tab';
import { AiUsageTab } from './ai-usage-tab';
import { UsersTab } from './users-tab';
import { AuditLogsTab } from './audit-logs/audit-logs-tab';

type TabId =
  | 'general'
  | 'security'
  | 'configuration'
  | 'notifications'
  | 'tokens'
  | 'ai'
  | 'ai-usage'
  | 'system'
  | 'about'
  | 'users'
  | 'audit-logs';

/**
 * The tab strip is grouped rather than a flat run of eleven entries.
 *
 * Personal settings first, then platform administration. A flat list made
 * "General" and "Audit logs" look like peers, which they are not: one is a
 * display name and the other is the security audit trail for the whole
 * instance.
 *
 * Each entry carries the heading its screen gets. The page header renders it,
 * so a tab does not repeat its own name at the top of its content — that
 * duplication is most of what made the old screens feel long before a single
 * setting had been read.
 */
const TABS: (SettingsTab<TabId> & { heading: string; blurb: string })[] = [
  {
    id: 'general',
    label: 'General',
    icon: IconSettings2,
    group: 'account',
    heading: 'General',
    blurb: 'Your profile and how this interface behaves on this device.',
  },
  {
    id: 'security',
    label: 'Security',
    icon: IconShieldLock,
    group: 'account',
    heading: 'Security',
    blurb: 'Your credentials and active sessions.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: IconBell,
    group: 'account',
    heading: 'Notifications',
    blurb: 'Choose which events should notify you. Changes save immediately.',
  },
  {
    id: 'tokens',
    label: 'API tokens',
    icon: IconKey,
    group: 'account',
    heading: 'API tokens',
    blurb: 'Credentials for programmatic access and integrations.',
  },

  {
    id: 'configuration',
    label: 'Configuration',
    icon: IconAdjustments,
    group: 'platform',
    adminOnly: true,
    heading: 'Configuration',
    blurb: 'Runtime behaviour of this instance. Changes take effect immediately.',
  },
  {
    id: 'users',
    label: 'Users',
    icon: IconUsers,
    group: 'platform',
    adminOnly: true,
    heading: 'Users',
    blurb: 'Manage accounts and access to this instance.',
  },
  {
    id: 'audit-logs',
    label: 'Audit logs',
    icon: IconHistory,
    group: 'platform',
    adminOnly: true,
    heading: 'Audit logs',
    blurb: 'Monitor and investigate activity across the platform.',
  },
  {
    id: 'ai',
    label: 'AI',
    icon: IconSparkles,
    group: 'platform',
    heading: 'AI',
    blurb: 'The model that enriches findings with remediation guidance.',
  },
  {
    id: 'ai-usage',
    label: 'AI usage',
    icon: IconCoin,
    group: 'platform',
    adminOnly: true,
    heading: 'AI usage',
    blurb: 'What AI enrichment has consumed across this instance.',
  },
  {
    id: 'system',
    label: 'System',
    icon: IconCpu,
    group: 'platform',
    heading: 'System',
    blurb: 'What this instance is running and what it can detect.',
  },
  {
    id: 'about',
    label: 'About',
    icon: IconInfoCircle,
    group: 'platform',
    heading: 'About',
    blurb: 'Version, mission and the stack behind this build.',
  },
];

const ADMIN_ONLY_IDS = new Set(TABS.filter((tab) => tab.adminOnly).map((tab) => tab.id));
const VALID_IDS = new Set<string>(TABS.map((tab) => tab.id));

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const requestedTab: TabId = VALID_IDS.has(tabParam ?? '') ? (tabParam as TabId) : 'general';

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    staleTime: 5 * 60_000,
  });

  const isAdmin = me?.role === 'ADMIN';

  /*
   * A non-admin deep-linking to ?tab=users must not land on a blank screen.
   * Hiding a tab is not authorisation — the API guards still reject the
   * requests — so the URL is normalised back to General rather than rendering
   * nothing. While `me` is still loading the requested tab is kept, so an admin
   * following a link is not bounced to General for a frame.
   */
  const activeTab: TabId =
    !isLoading && !isAdmin && ADMIN_ONLY_IDS.has(requestedTab) ? 'general' : requestedTab;

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  // `replace` rather than `push`: eleven tab changes should not mean eleven
  // presses of the back button to leave Settings.
  const selectTab = (id: TabId) => router.replace(`${pathname}?tab=${id}`, { scroll: false });

  return (
    <PageContainer>
      <header className="mb-4">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem>
              {/*
                A button rather than a link: this navigates by rewriting the
                query string, and an `<a>` without an href is not reachable by
                keyboard however it is styled.
              */}
              <BreadcrumbLink asChild>
                <button
                  type="button"
                  onClick={() => selectTab('general')}
                  className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Settings
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{current.heading}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {current.heading}
        </h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{current.blurb}</p>
      </header>

      <SettingsNavigation
        tabs={visibleTabs}
        active={activeTab}
        onSelect={selectTab}
        className="mb-6"
      />

      <div className="min-w-0">
        {activeTab === 'general' && <GeneralTab user={me} />}
        {activeTab === 'security' && <SecurityTab />}
        {activeTab === 'notifications' && <NotificationsTab isAdmin={Boolean(isAdmin)} />}
        {activeTab === 'tokens' && <TokensTab />}
        {activeTab === 'configuration' && isAdmin && <ConfigurationTab />}
        {activeTab === 'users' && isAdmin && <UsersTab currentUserId={me?.id ?? ''} />}
        {activeTab === 'audit-logs' && isAdmin && <AuditLogsTab isAdmin={Boolean(isAdmin)} />}
        {activeTab === 'ai' && <AiConfigTab />}
        {activeTab === 'ai-usage' && isAdmin && <AiUsageTab />}
        {activeTab === 'system' && <SystemTab />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </PageContainer>
  );
}
