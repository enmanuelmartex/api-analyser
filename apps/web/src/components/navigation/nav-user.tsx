"use client";

import Link from "next/link";
import {
  IconDotsVertical,
  IconLogout,
  IconUserCircle,
} from "@tabler/icons-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { NavUserAvatar } from "@/components/navigation/nav-user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { useNotificationSummary } from "@/hooks/use-notification-summary";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { clearStoredPreferences } from "@/lib/user-preferences";

interface NavUserProps {
  user?: {
    name: string;
    email: string;
    role: string;
    avatarColor?: string | null;
  } | null;
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile, state } = useSidebar();

  /*
   * The same cache entry the header bell and the sidebar badges read — React
   * Query dedupes by key, so this hook costs no extra request and cannot
   * disagree with them. `totalUnread` counts every category, including the
   * SECURITY and SYSTEM ones that have no sidebar row of their own.
   *
   * `isReady` gates it so a page load does not paint a badge reading zero
   * before the first response lands.
   */
  const summary = useNotificationSummary();
  const unreadCount = summary.isReady ? summary.totalUnread : 0;

  /**
   * Two auth surfaces, two things to tear down (see `apps/api/src/lib/auth.ts`):
   * the exchanged JWT this app actually uses lives only in `localStorage` and
   * is stateless, but signing in also created a Better Auth session row on the
   * server. Only clearing `localStorage` left that row valid — logging out
   * locally without ever revoking the session it was minted from.
   */
  async function handleLogout() {
    try {
      await authClient.signOut();
    } catch {
      // Best-effort: the local session is cleared regardless below.
    }
    localStorage.removeItem("api_analyser_token");
    localStorage.removeItem("api_analyser_user");
    // Cached timezone and date format belong to the account signing out, not to
    // the machine — without this the next person to sign in here reads their
    // timestamps through a stranger's clock until `/auth/me` lands.
    clearStoredPreferences();
    window.location.href = "/login";
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              // The badge is `aria-hidden`, so the count has to reach a screen
              // reader through the trigger's own name or not at all.
              aria-label={
                unreadCount > 0
                  ? `Open user menu, ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                  : "Open user menu"
              }
              title={
                state === "collapsed" && !isMobile
                  ? user?.name || "User menu"
                  : undefined
              }
              className={cn(
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                /*
                 * The one layout concession this feature needs.
                 *
                 * Every sidebar row is `overflow-hidden`, which is right for a
                 * row whose only job is to clip a long label — but here it also
                 * clips the avatar's ring and shears the badge against the
                 * button's rounded corner in the collapsed rail, where the
                 * button is exactly the size of the halo. Nothing else in this
                 * row relies on it: the two labels below clip themselves with
                 * `truncate`, and this row has no active rail to contain.
                 */
                "overflow-visible",
              )}
            >
              <NavUserAvatar
                name={user?.name}
                color={user?.avatarColor}
                unreadCount={unreadCount}
              />
              {(state === "expanded" || isMobile) && (
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user?.name || "User"}
                  </span>
                  <span className="truncate text-xs text-sidebar-foreground/60">
                    {user?.email || "—"}
                  </span>
                </div>
              )}
              {(state === "expanded" || isMobile) && (
                <IconDotsVertical className="ml-auto h-4 w-4" />
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                {/*
                  Circular, like the trigger it opens from — and like every
                  other avatar in the product, all of which take the base
                  component's default. This row was the last squared one, and
                  drawing the same person as a circle in the footer and a
                  squircle two centimetres above it reads as a bug.
                */}
                <UserAvatar
                  name={user?.name}
                  color={user?.avatarColor}
                  className="size-8"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user?.name || "User"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user?.email || "—"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings?tab=general">
                <IconUserCircle className="h-4 w-4" />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm">Theme</span>
              <ThemeSwitcher />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <IconLogout className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
