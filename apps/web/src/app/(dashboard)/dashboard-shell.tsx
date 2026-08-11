"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { IconLoader2 } from "@tabler/icons-react";
import { authApi } from "@/lib/api";

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

  const ready = hasToken === true && !isLoading && !isError && !!user;

  if (!ready) {
    return <SessionSpinner />;
  }

  return (
    <DashboardChrome user={user} defaultSidebarOpen={defaultSidebarOpen}>
      {children}
    </DashboardChrome>
  );
}
