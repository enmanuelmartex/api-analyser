import type { Icon } from '@tabler/icons-react';
import {
  IconLayoutDashboard,
  IconFolder,
  IconActivity,
  IconBug,
  IconFileText,
  IconShieldCheck,
  IconSettings,
} from '@tabler/icons-react';

export interface NavLeaf {
  title: string;
  url: string;
  icon: Icon;
  /** Match this exact path only, instead of prefix-matching */
  exact?: boolean;
  /** Only show when the current user is an admin */
  adminOnly?: boolean;
  /**
   * Optional subdivision within the group, rendered as a small heading above
   * the first item that carries it. Keeps account-level preferences visually
   * separate from tenant-wide administration without splitting Settings into
   * two top-level entries.
   */
  section?: string;
}

export interface NavGroup {
  title: string;
  icon: Icon;
  items: NavLeaf[];
}

/**
 * The product's primary navigation.
 *
 * Three naming decisions, all about not misleading the user:
 *
 *  - "Scans", not "Assessments". The user runs a scan; "assessment" is the
 *    persistence model's word and leaks internal vocabulary into the UI. The
 *    `/assessments` routes are unchanged — this is a label, not a migration.
 *
 *  - "Security Checks", not "Plugins" / "Installed Plugins". The checks are
 *    compiled into the scanner. Calling them installed plugins implies a
 *    package registry, optional installation and third-party checks, none of
 *    which exist.
 *
 *  - Settings is one entry. It previously expanded into nine sidebar children
 *    that duplicated the page's own sections, producing two active states for
 *    one destination. The tab strip now lives inside the Settings page, where
 *    a tabbed screen's navigation belongs.
 */
export const NAV_MAIN: NavLeaf[] = [
  { title: 'Dashboard', url: '/dashboard', icon: IconLayoutDashboard, exact: true },
  { title: 'Projects', url: '/projects', icon: IconFolder },
  { title: 'Scans', url: '/assessments', icon: IconActivity },
  { title: 'Issues', url: '/issues', icon: IconBug },
  { title: 'Reports', url: '/reports', icon: IconFileText },
  { title: 'Security Checks', url: '/plugins', icon: IconShieldCheck },
  { title: 'Settings', url: '/settings', icon: IconSettings },
];

/**
 * Kept as an empty list rather than deleted: `NavCollapsible` and the group
 * types are still the mechanism for any future grouped section, and removing
 * them would be a larger change than this rename warrants.
 */
export const NAV_COLLAPSIBLE: NavGroup[] = [];

export function isLeafActive(pathname: string, search: string, item: NavLeaf): boolean {
  const [itemPath, itemQuery] = item.url.split('?');
  if (itemQuery) {
    const itemTab = new URLSearchParams(itemQuery).get('tab');
    const currentTab = new URLSearchParams(search).get('tab') ?? 'general';
    return pathname === itemPath && currentTab === itemTab;
  }
  if (item.exact) return pathname === itemPath;
  // Security Checks owns every /plugins route, profiles included — profiles is
  // a tab within that screen, not a separate destination.
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function isGroupActive(pathname: string, search: string, group: NavGroup): boolean {
  return group.items.some((item) => isLeafActive(pathname, search, item));
}
