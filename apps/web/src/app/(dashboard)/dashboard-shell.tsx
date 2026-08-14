"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { IconLoader2 } from "@tabler/icons-react";
import { authApi } from "@/lib/api";
import { clearStoredPreferences, setPreferences } from "@/lib/user-preferences";
import { useNotificationStream } from "@/hooks/use-notification-summary";
import { ThemeSync } from "@/components/layout/theme-sync";

/**
 * `ssr: false` is safe (not just an optimisation) here: `ready` — the only
 * condition under which this renders — depends on `hasToken`, which starts
 * `null` on every server render because the server cannot read
 * `localStorage`. This chunk is therefore never part of the server-rendered
 * HTML regardless; deferring it to a dynamic import just stops the client
 * from paying to parse and execute it before it's needed too. See
 * `dashboard-chrome.tsx` for what that buys.
 */
const DashboardChrome = dynamic(
  () => import("./dashboard-chrome").then((m) => m.DashboardChrome),
  {
    ssr: false,
    loading: () => <SessionSpinner />,
  },
);

function SessionSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" aria-busy="true">
      <IconLoader2 className="h-6 w-6 animate-spin text-primary" aria-label="Checking session" />
    </div>
  );
}

function clearSession() {
  localStorage.removeItem("api_analyser_token");
  localStorage.removeItem("api_analyser_user");
  // The cached preferences belong to the account that just went away. Leaving
  // them behind means the next person to sign in on this machine reads their
  // timestamps in a stranger's timezone until `/auth/me` returns.
  clearStoredPreferences();
}

/**
 * The dashboard chrome — and the only gate every route under `(dashboard)`
 * has, since the token lives in `localStorage`, which no server component or
 * Next.js middleware can read.
 *
 * This used to trust `localStorage` at face value: if a token string was
 * present it rendered the sidebar immediately using whatever `api_analyser_user`
 * JSON happened to be cached, without ever asking the API whether that token
 * was still valid. A stale or expired token — left over from a previous
 * session, container rebuild, or test account — was enough to render the full
 * dashboard with a stale cached identity (e.g. a leftover ANALYST test user)
 * before any data request finally 401'd and bounced to `/login`. That is the
 * "opens straight into the dashboard as analyst" bug: not a hardcoded fallback
 * user anywhere, but a client guard that checked for a token's *presence*
 * instead of its *validity*, and rendered protected chrome while that check
 * was still pending.
 *
 * Now nothing protected renders until `GET /auth/me` has confirmed the token
 * server-side. No token, a 401, or a network error all take the same path:
 * clear the local session and redirect to `/login`. The freshly-fetched user
 * — never the cached copy — is what gets rendered.
 */
export function DashboardShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // Token presence is checked once, after mount (the server cannot read
  // localStorage). Until then `hasToken` is `null`, meaning "not decided yet" —
  // distinct from `false`, so the very first client render never briefly
  // renders the "redirect to /login" state for someone who is in fact signed
  // in, only to flip back a moment later.
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    setHasToken(!!localStorage.getItem("api_analyser_token"));
  }, []);

  const {
    data: user,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: hasToken === true,
    retry: false,
  });

  useEffect(() => {
    if (hasToken === false || isError) {
      clearSession();
      router.replace("/login");
    }
  }, [hasToken, isError, router]);

  /*
   * One EventSource for the whole application, opened here because this is the
   * only component guaranteed to be mounted for the entire session.
   *
   * It updates the React Query cache that the sidebar badges and the header bell
   * both read, so a scan finishing in another tab updates every counter without
   * a refresh — and without either of them owning a connection of its own.
   *
   * Purely an optimisation: every notification is a database row before it is
   * streamed, so a user who was offline sees exactly the same counts on their
   * next page load.
   *
   * Called unconditionally, ABOVE the `!ready` return below. It sat underneath
   * it until the session gate was added, which meant the hook ran on some
   * renders and not others — React matches hooks positionally, so the counts
   * silently attached themselves to whatever hook happened to occupy that slot.
   * Connecting early costs nothing: the effect reads the token itself and does
   * not open a stream without one.
   */
  useNotificationStream();

  const ready = hasToken === true && !isLoading && !isError && !!user;

  /*
   * The account's timezone and date format, pushed into the store every
   * dated view reads from (`lib/user-preferences.ts`).
   *
   * Done here during render rather than in an effect, and deliberately: an
   * effect runs *after* the children have painted, so every timestamp on the
   * first screen would render in the default format and then visibly reformat
   * itself. `setPreferences` compares before it writes and no-ops when nothing
   * differs, so calling it on every render is free and cannot loop.
   *
   * This is also the only place it needs doing. `/auth/me` is the one request
   * guaranteed to precede any protected content, and the settings screen writes
   * its result back into this same `['me']` cache entry — so a saved preference
   * arrives here on the very next render.
   */
  if (ready) setPreferences(user);

  if (!ready) {
    return <SessionSpinner />;
  }

  return (
    <DashboardChrome user={user} defaultSidebarOpen={defaultSidebarOpen}>
      {/*
        Mounted here rather than beside the other providers, because it issues
        an authenticated PATCH. Above this point there is no confirmed session —
        `(auth)` routes render the same provider tree — and a mirror that fired
        on the login screen would 401 on every visit.
      */}
      <ThemeSync />
      {children}
    </DashboardChrome>
  );
}
