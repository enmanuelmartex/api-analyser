'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NAV_MAIN, isLeafActive } from '@/components/navigation/nav-data';
import { NavBadge, NavBadgeDot } from '@/components/navigation/nav-badge';
import { useNotificationSummary } from '@/hooks/use-notification-summary';

export function NavMain() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // One call for the whole sidebar. React Query dedupes it with the header
  // bell's identical call, so the two cannot show different numbers and the
  // list still costs a single request.
  const summary = useNotificationSummary();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_MAIN.map((item) => {
            const active = isLeafActive(pathname, search, item);
            // Suppressed until the first response lands, so the badges appear
            // once rather than counting up from zero on every page load.
            const count = item.badge && summary.isReady ? summary[item.badge] : 0;

            return (
              <SidebarMenuItem key={item.url} className="relative">
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  // The rail has no room for a number, so the count goes in the
                  // tooltip that the collapsed sidebar already shows.
                  tooltip={count > 0 ? `${item.title} — ${count} unread` : item.title}
                >
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                    {/*
                     * `ml-auto` pins the badge to the right edge without
                     * changing the row's height or moving the label: it takes
                     * the free space in the existing flex row rather than
                     * introducing a new layout. Hidden on the collapsed rail,
                     * where the dot below takes over.
                     */}
                    <NavBadge count={count} className="ml-auto group-data-[collapsible=icon]:hidden" />
                  </Link>
                </SidebarMenuButton>

                {/*
                 * Collapsed-rail indicator. Rendered outside the button so it is
                 * positioned against the menu item rather than inside the link's
                 * flex row, and shown only when the sidebar is a rail.
                 */}
                <div className="hidden group-data-[collapsible=icon]:block">
                  <NavBadgeDot count={count} />
                </div>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
