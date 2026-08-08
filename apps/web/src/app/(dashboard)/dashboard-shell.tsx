"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { CommandMenuProvider } from "@/components/layout/command-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * The dashboard chrome.
 *
 * This used to render nothing but a centred spinner until a `mounted` flag
 * flipped in an effect, because the sidebar read `window` and `document` during
 * render and so could not be server-rendered. The cost was that the server sent
 * a page with no content in it: the `h1` is this route's LCP element, and it did
 * not exist until React had downloaded, parsed and hydrated ~156 kB of
 * JavaScript. Lighthouse measured LCP at 2.7 s against an FCP of 0.6 s.
 *
 * The shell now renders on the server. Auth is still enforced from the client —
 * the token lives in `localStorage`, which the server cannot read — but the
 * redirect runs in an effect instead of gating the whole tree behind it. An
 * unauthenticated visitor may see the empty chrome for one frame before being
 * sent to `/login`; no data is exposed, because every query needs the token the
 * visitor does not have.
 */
export function DashboardShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<{
    name: string;
    email: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("iasa_token");
    const userData = localStorage.getItem("iasa_user");

    if (!token) {
      router.push("/login");
      return;
    }

    if (userData) {
      try {
        setUser(JSON.parse(userData));
      } catch {}
    }
  }, [router]);

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
