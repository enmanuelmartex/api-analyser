'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconLoader2 } from '@tabler/icons-react';
import { toast } from 'sonner';
import { authClient, AUTH_BASE_URL } from '@/lib/auth-client';
import { authApi } from '@/lib/api';
import { appBrand } from '@/lib/brand';
import { AppLogo } from '@/components/brand/app-logo';

// OAuth callback page — landed here after Google OAuth completes.
// Better Auth sets a session cookie; we read it with getSession() then exchange for JWT.
function AuthCallbackContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const ran          = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    async function finish() {
      // 1. Better Auth v1.6.x may pass token as ?token= for some flows (bearer plugin)
      const urlToken = searchParams.get('token');
      if (urlToken) {
        return exchange(urlToken);
      }

      // 2. For social OAuth, Better Auth sets a session cookie — read it via getSession()
      const sessionRes = await authClient.getSession();
      const sessionToken = (sessionRes.data as any)?.session?.token;
      if (sessionToken) {
        return exchange(sessionToken);
      }

      // 3. Fallback: try fetching session directly from the API (handles cookie forwarding)
      try {
        const res = await fetch(`${AUTH_BASE_URL}/api/auth/get-session`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          const token = data?.session?.token;
          if (token) return exchange(token);
        }
      } catch {}

      toast.error('Sign-in failed — no session received');
      router.replace('/login');
    }

    async function exchange(sessionToken: string) {
      try {
        const data = await authApi.exchangeSession(sessionToken);
        localStorage.setItem('iasa_token', data.accessToken);
        localStorage.setItem('iasa_user', JSON.stringify(data.user));
        router.replace('/dashboard');
      } catch {
        toast.error('Failed to complete sign-in. Please try again.');
        router.replace('/login');
      }
    }

    finish();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background" aria-busy="true">
      <AppLogo variant="full" size={32} className="mb-6" nameClassName="text-lg" />
      <IconLoader2 className="mb-3 h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
          <IconLoader2 className="h-6 w-6 animate-spin text-primary" aria-label="Completing sign in" />
        </main>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
