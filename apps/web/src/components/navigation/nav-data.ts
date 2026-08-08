import type { Icon } from '@tabler/icons-react';
import {
  IconLayoutDashboard,
  IconFolder,
  IconActivity,
  IconBug,
  IconFileText,
  IconPuzzle,
  IconStack2,
  IconSettings,
  IconUser,
  IconShieldLock,
  IconKey,
  IconBell,
  IconRobot,
  IconServer2,
  IconInfoCircle,
  IconUsers,
  IconHistory,
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

export const NAV_MAIN: NavLeaf[] = [
  { title: 'Dashboard', url: '/dashboard', icon: IconLayoutDashboard, exact: true },
  { title: 'Projects', url: '/projects', icon: IconFolder },
  { title: 'Assessments', url: '/assessments', icon: IconActivity },
  { title: 'Issues', url: '/issues', icon: IconBug },
  { title: 'Reports', url: '/reports', icon: IconFileText },
];

export const NAV_COLLAPSIBLE: NavGroup[] = [
  {
    title: 'Plugins',
    icon: IconPuzzle,
    items: [
      { title: 'Installed Plugins', url: '/plugins', icon: IconPuzzle, exact: true },
      { title: 'Profiles', url: '/plugins/profiles', icon: IconStack2 },
    ],
  },
  {
    title: 'Settings',
    icon: IconSettings,
    items: [
      { title: 'General', url: '/settings?tab=general', icon: IconUser },
      { title: 'Security', url: '/settings?tab=security', icon: IconShieldLock },
      { title: 'API Tokens', url: '/settings?tab=tokens', icon: IconKey },
      { title: 'Notifications', url: '/settings?tab=notifications', icon: IconBell },
      { title: 'AI Configuration', url: '/settings?tab=ai', icon: IconRobot },
      { title: 'System', url: '/settings?tab=system', icon: IconServer2 },
      { title: 'About', url: '/settings?tab=about', icon: IconInfoCircle },
      // Administration is admin-only. Hiding these is a UI affordance, not a
      // control: the backend guards on /users and /audit-logs still reject a
      // non-admin who types the URL.
      { title: 'Users', url: '/settings?tab=users', icon: IconUsers, adminOnly: true, section: 'Administration' },
      { title: 'Audit Logs', url: '/settings?tab=audit-logs', icon: IconHistory, adminOnly: true, section: 'Administration' },
    ],
  },
];

export function isLeafActive(pathname: string, search: string, item: NavLeaf): boolean {
  const [itemPath, itemQuery] = item.url.split('?');
  if (itemQuery) {
    const itemTab = new URLSearchParams(itemQuery).get('tab');
    const currentTab = new URLSearchParams(search).get('tab') ?? 'general';
    return pathname === itemPath && currentTab === itemTab;
  }
  if (item.exact) return pathname === itemPath;
  if (itemPath === '/plugins') return pathname === '/plugins' || /^\/plugins\/(?!profiles)/.test(pathname);
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function isGroupActive(pathname: string, search: string, group: NavGroup): boolean {
  return group.items.some((item) => isLeafActive(pathname, search, item));
}
