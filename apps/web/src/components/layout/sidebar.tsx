'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Shield,
  LayoutDashboard,
  FolderOpen,
  Activity,
  Bug,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
  Puzzle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppLogo } from '@/components/brand/app-logo';

const navItems = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Security',
    items: [
      { href: '/projects', icon: FolderOpen, label: 'Projects' },
      { href: '/assessments', icon: Activity, label: 'Assessments' },
      { href: '/findings', icon: Bug, label: 'Findings' },
      { href: '/reports', icon: FileText, label: 'Reports' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/plugins', icon: Puzzle, label: 'Plugins' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

interface SidebarProps {
  user?: { name: string; email: string; role: string } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  function handleLogout() {
    localStorage.removeItem('iasa_token');
    localStorage.removeItem('iasa_user');
    window.location.href = '/login';
  }

  return (
    <aside className="w-60 min-h-screen flex flex-col bg-slate-950 border-r border-slate-800/60">
      {/* Logo. NOTE: this component is legacy and currently unrendered —
          `app-sidebar.tsx` is the live sidebar. Kept in sync with the brand so
          no stale product name survives anywhere in the tree. */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-800/60">
        <AppLogo variant="full" size={32} nameClassName="text-lg text-white" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navItems.map((section) => (
          <div key={section.label} className="mb-6">
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors group',
                      isActive
                        ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'w-4 h-4 flex-shrink-0',
                        isActive ? 'text-violet-400' : 'text-slate-500 group-hover:text-slate-300',
                      )}
                    />
                    {item.label}
                    {isActive && (
                      <ChevronRight className="w-3 h-3 ml-auto text-violet-500/60" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Version tag */}
      <div className="px-4 py-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/40 border border-slate-800">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-slate-500 font-mono">v0.1.0</span>
          <span className="ml-auto text-[11px] text-violet-500">MVP</span>
        </div>
      </div>

      {/* User */}
      <div className="p-3 border-t border-slate-800/60">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/60 transition-colors group">
          <div className="w-7 h-7 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-medium text-violet-400">
              {user?.name?.charAt(0)?.toUpperCase() || 'A'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-300 truncate">{user?.name || 'Analyst'}</p>
            <p className="text-[10px] text-slate-600 truncate">{user?.role || 'ANALYST'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
