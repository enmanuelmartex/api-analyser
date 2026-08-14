'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { NAV_MAIN, NAV_COLLAPSIBLE } from '@/components/navigation/nav-data';
import { NotificationCenter } from '@/components/notifications/notification-center';

function resolveTitle(pathname: string, search: string): string {
  for (const item of NAV_MAIN) {
    if (item.exact ? pathname === item.url : pathname === item.url || pathname.startsWith(`${item.url}/`)) {
      return item.title;
    }
  }
  for (const group of NAV_COLLAPSIBLE) {
    for (const item of group.items) {
      const [itemPath, itemQuery] = item.url.split('?');
      if (itemQuery) {
        const itemTab = new URLSearchParams(itemQuery).get('tab');
        const currentTab = new URLSearchParams(search).get('tab') ?? 'general';
        if (pathname === itemPath && currentTab === itemTab) return `${group.title} · ${item.title}`;
      } else if (pathname === itemPath || pathname.startsWith(`${itemPath}/`)) {
        return item.title;
      }
    }
  }
  const segment = pathname.split('/').filter(Boolean).pop();
  if (!segment) return 'Dashboard';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function SiteHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const title = resolveTitle(pathname, searchParams.toString());

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4" />
        <h1 className="text-sm font-medium text-foreground">{title}</h1>
        {/* `ml-auto` on a spacer rather than the bell, so anything added to the
            header later sits beside it instead of pushing it around. */}
        <div className="ml-auto flex items-center gap-1">
          <NotificationCenter />
        </div>
      </div>
    </header>
  );
}
