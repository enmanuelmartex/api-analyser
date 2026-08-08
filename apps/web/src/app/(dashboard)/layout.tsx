import { cookies } from "next/headers";
import { DashboardShell } from "./dashboard-shell";

/** Must match `SIDEBAR_COOKIE_NAME` in `@/components/ui/sidebar`. */
const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * A server component, so the sidebar's persisted open/closed state is known
 * before the first byte is sent. Reading it here rather than from
 * `document.cookie` during the client render is what allows the whole shell to
 * be server-rendered — see `DashboardShell` for why that matters.
 *
 * Reading a cookie opts these routes out of static generation. That is the
 * intended trade: the shell is per-user chrome behind an auth check, and the
 * alternative is shipping HTML that assumes the sidebar is expanded and then
 * snapping it closed for everyone who collapsed it.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const persisted = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value;

  return (
    <DashboardShell defaultSidebarOpen={persisted ? persisted === "true" : true}>
      {children}
    </DashboardShell>
  );
}
