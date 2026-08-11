"use client";

import Link from "next/link";
import {
  IconDotsVertical,
  IconLogout,
  IconUserCircle,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { authClient } from "@/lib/auth-client";

interface NavUserProps {
  user?: { name: string; email: string; role: string } | null;
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile, state } = useSidebar();
  const initial = user?.name?.charAt(0)?.toUpperCase() || "U";

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
    window.location.href = "/login";
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Open user menu"
              title={
                state === "collapsed" && !isMobile
                  ? user?.name || "User menu"
                  : undefined
              }
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg border border-sidebar-border">
                <AvatarFallback className="rounded-lg">
                  {initial}
                </AvatarFallback>
              </Avatar>
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
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initial}
                  </AvatarFallback>
                </Avatar>
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
