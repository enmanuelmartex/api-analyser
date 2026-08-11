'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { IconEye, IconEyeOff, IconCheck, IconX, IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
import { authClient } from '@/lib/auth-client';
import { authApi, usersApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { appBrand } from '@/lib/brand';
import { BrandLogo } from '@/components/brand/brand-logo';

function getPasswordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&#^()_\-+=[\]{}|;':",./<>?]/.test(password),
  };
}

interface InviteInfo {
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: string;
}

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('token') ?? '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [verifying, setVerifying] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [nameTouched, setNameTouched] = useState(false);
  const [passTouched, setPassTouched] = useState(false);
  const [nameError, setNameError] = useState('');

  const passwordChecks = getPasswordChecks(password);
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  // ── Verify invite token on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!inviteToken) {
      setInviteError('No invitation token provided.');
      setVerifying(false);
      return;
    }
    usersApi
      .verifyInvite(inviteToken)
      .then((data: InviteInfo) => {
        setInvite(data);
        setVerifying(false);
      })
      .catch(() => {
        setInviteError('This invitation is invalid or has expired.');
        setVerifying(false);
      });
  }, [inviteToken]);

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameTouched(true);
    setPassTouched(true);
    const ne = !name.trim() ? 'Full name is required' : name.trim().length < 2 ? 'Name must be at least 2 characters' : '';
    setNameError(ne);
    if (ne || !passwordValid || !invite) return;

    setLoading(true);
    try {
      // 1. Sign up via Better Auth
      const result = await authClient.signUp.email({
        email: invite.email,
        name: name.trim(),
        password,
      });
      if (result.error) throw new Error(result.error.message);

      const sessionToken = (result.data as any)?.session?.token ?? (result.data as any)?.token;
      if (!sessionToken) throw new Error('No session token received');

      // 2. Exchange Better Auth session for a JWT (role=ADMIN at this point due to databaseHook)
      const data = await authApi.exchangeSession(sessionToken);
      localStorage.setItem('api_analyser_token', data.accessToken);
      localStorage.setItem('api_analyser_user', JSON.stringify(data.user));

      // 3. Accept the invitation (updates DB: role=ANALYST/VIEWER, ownerId=inviter.id)
      await usersApi.acceptInvite(inviteToken);

      // 4. Re-exchange the session now that the role is updated in DB.
      //    exchangeSession reads role from DB at call time, so this JWT has the correct role.
      const fresh = await authApi.exchangeSession(sessionToken);
      localStorage.setItem('api_analyser_token', fresh.accessToken);
      localStorage.setItem('api_analyser_user', JSON.stringify(fresh.user));

      toast.success(`Welcome to ${appBrand.name}! You've joined as ${invite.role}.`);
      router.replace('/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Loading / error states ────────────────────────────────────────────────────
  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" aria-busy="true">
        <IconLoader2 className="h-6 w-6 animate-spin text-primary" aria-label="Verifying invitation" />
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <IconAlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="mb-2 text-lg font-semibold text-foreground">Invalid Invitation</h1>
          <p className="mb-6 text-sm text-muted-foreground">{inviteError}</p>
          <Link href="/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  // ── Registration form ─────────────────────────────────────────────────────────
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo type="horizontal" size={48} />
        </div>

        <div className="relative overflow-hidden rounded-xl border border-border bg-card p-8 shadow-sm">
          <span className="brand-rule absolute inset-x-0 top-0 h-px" aria-hidden="true" />
          {/* Invite banner */}
          <div className="mb-6 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3">
            <p className="text-sm text-foreground">
              <strong>{invite!.invitedBy}</strong> has invited you to join as <strong>{invite!.role}</strong>
            </p>
          </div>

          <h1 className="mb-1 text-xl font-semibold text-foreground">Create your account</h1>
          <p className="mb-6 text-sm text-muted-foreground">Complete your account setup to get started</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email — readonly, pre-filled from invite */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" value={invite!.email} readOnly disabled className="cursor-not-allowed" />
            </div>

            {/* Full name */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameTouched) setNameError(!e.target.value.trim() ? 'Required' : '');
                }}
                onBlur={() => {
                  setNameTouched(true);
                  setNameError(!name.trim() ? 'Full name is required' : '');
                }}
                placeholder="Jane Smith"
                autoComplete="name"
                aria-invalid={!!(nameError && nameTouched)}
                className={cn(nameError && nameTouched && 'border-destructive focus-visible:ring-destructive')}
              />
              {nameError && nameTouched && <p className="text-xs text-destructive">{nameError}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setPassTouched(true)}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  className={cn(
                    'pr-10',
                    passTouched && !passwordValid && 'border-destructive focus-visible:ring-destructive',
                    passTouched && passwordValid && 'border-success focus-visible:ring-success',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                </button>
              </div>

              {(password.length > 0 || passTouched) && (
                <div className="mt-2.5 space-y-1">
                  {[
                    { key: 'length', label: 'At least 8 characters' },
                    { key: 'upper', label: 'One uppercase letter' },
                    { key: 'lower', label: 'One lowercase letter' },
                    { key: 'number', label: 'One number' },
                    { key: 'special', label: 'One special character' },
                  ].map(({ key, label }) => {
                    const ok = passwordChecks[key as keyof typeof passwordChecks];
                    return (
                      <div key={key} className="flex items-center gap-2">
                        {ok ? (
                          <IconCheck className="h-3 w-3 flex-shrink-0 text-success" />
                        ) : (
                          <IconX className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
                        )}
                        <span className={cn('text-xs', ok ? 'text-success' : 'text-muted-foreground')}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'Creating account…' : 'Accept invitation & create account'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
          <IconLoader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading invitation" />
        </main>
      }
    >
      <AcceptInviteForm />
    </Suspense>
  );
}
