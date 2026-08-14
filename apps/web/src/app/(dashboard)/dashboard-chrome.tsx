"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { CommandMenuProvider } from "@/components/layout/command-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface DashboardUser {
  name: string;
  email: string;
  role: string;
}

/**
 * The sidebar, header and command palette — split out of `DashboardShell` so
 * it can be behind a `next/dynamic(..., { ssr: false })` import there. None
 * of it renders until the auth check resolves (`ready`), but a static import
 * still puts its whole module graph — `ui/sidebar` alone is 700+ lines, plus
 * every nav item's icons and the cmdk-based command menu — in the chunk that
 * has to be parsed and executed before the "checking session" spinner can
 * even paint. Anonymous visitors bounced from a protected route straight to
 * `/login` never render any of this, so under a dynamic import they never
 * pay to download it either.
 */
export function DashboardChrome({
  user,
  defaultSidebarOpen,
  children,
}: {
  user: DashboardUser;
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <CommandMenuProvider>
      <SidebarProvider
        defaultOpen={defaultSidebarOpen}
        style={
          {
            "--sidebar-width": "18rem",
            "--sidebar-width-icon": "3.25rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar user={user} />
        <SidebarInset>
          <SiteHeader />
          <main className="flex-1 overflow-auto">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </CommandMenuProvider>
  );
}
