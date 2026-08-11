'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { IconEye, IconEyeOff, IconCheck, IconX } from '@tabler/icons-react';
import { authClient } from '@/lib/auth-client';
import { authApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { appBrand } from '@/lib/brand';
import { BrandLogo } from '@/components/brand/brand-logo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPasswordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&#^()_\-+=[\]{}|;':",./<>?]/.test(password),
  };
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Touched state — each field shows errors only after the user has interacted
  const [touched, setTouched] = useState({ name: false, email: false, password: false });
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');

  const passwordChecks = getPasswordChecks(form.password);
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  // ── Field validators ───────────────────────────────────────────────────────

  function validateName(value: string): string {
    if (!value.trim()) return 'Full name is required';
    if (value.trim().length < 2) return 'Name must be at least 2 characters';
    return '';
  }

  function validateEmail(value: string): string {
    if (!value) return 'Email is required';
    if (!EMAIL_RE.test(value)) return 'Invalid email format';
    return '';
  }

  // ── Change handlers ────────────────────────────────────────────────────────

  function handleNameChange(value: string) {
    setForm((f) => ({ ...f, name: value }));
    if (touched.name) setNameError(validateName(value));
  }

  function handleEmailChange(value: string) {
    setForm((f) => ({ ...f, email: value }));
    if (touched.email) setEmailError(validateEmail(value));
  }

  function handlePasswordChange(value: string) {
    setForm((f) => ({ ...f, password: value }));
    // Password requirements update live — no separate error needed
  }

  // ── Blur handlers ──────────────────────────────────────────────────────────

  function handleNameBlur() {
    setTouched((t) => ({ ...t, name: true }));
    setNameError(validateName(form.name));
  }

  function handleEmailBlur() {
    setTouched((t) => ({ ...t, email: true }));
    setEmailError(validateEmail(form.email));
  }

  function handlePasswordBlur() {
    setTouched((t) => ({ ...t, password: true }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Force all touched so errors appear
    setTouched({ name: true, email: true, password: true });
    const ne = validateName(form.name);
    const ee = validateEmail(form.email);
    setNameError(ne);
    setEmailError(ee);
    if (ne || ee || !passwordValid) return;

    setLoading(true);
    try {
      // Use Better Auth for sign-up (bearer plugin returns token in body)
      const result = await authClient.signUp.email({
        email: form.email,
        name: form.name,
        password: form.password,
      });
      if (result.error) throw new Error(result.error.message);
      const sessionToken = (result.data as any)?.session?.token ?? (result.data as any)?.token;
      if (!sessionToken) throw new Error('No session token received');
      const data = await authApi.exchangeSession(sessionToken);
      localStorage.setItem('iasa_token', data.accessToken);
      localStorage.setItem('iasa_user', JSON.stringify(data.user));
      toast.success(`Account created! Welcome to ${appBrand.name}.`);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.message || err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo type="horizontal" size={48} />
          <p className="text-sm text-muted-foreground">{appBrand.tagline}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-border bg-card p-8 shadow-sm">
          <span className="brand-rule absolute inset-x-0 top-0 h-px" aria-hidden="true" />
          <h1 className="mb-1 text-xl font-semibold text-foreground">Create an account</h1>
          <p className="mb-6 text-sm text-muted-foreground">Start securing your APIs in minutes</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Full name */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                type="text"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={handleNameBlur}
                placeholder="Jane Smith"
                autoComplete="name"
                aria-invalid={!!(nameError && touched.name)}
                className={cn(nameError && touched.name && 'border-destructive focus-visible:ring-destructive')}
              />
              {nameError && touched.name && <p className="text-xs text-destructive">{nameError}</p>}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="analyst@company.com"
                autoComplete="email"
                aria-invalid={!!(emailError && touched.email)}
                className={cn(emailError && touched.email && 'border-destructive focus-visible:ring-destructive')}
              />
              {emailError && touched.email && <p className="text-xs text-destructive">{emailError}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onBlur={handlePasswordBlur}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  className={cn(
                    'pr-10',
                    touched.password && !passwordValid && 'border-destructive focus-visible:ring-destructive',
                    touched.password && passwordValid && 'border-success focus-visible:ring-success',
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

              {/* Live password requirements — shown as soon as user starts typing */}
              {(form.password.length > 0 || touched.password) && (
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
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <>
              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-3 text-muted-foreground">or continue with</span>
                </div>
              </div>

              {/* Google OAuth */}
              <Button
                type="button"
                variant="outline"
                loading={googleLoading}
                className="w-full"
                onClick={async () => {
                  setGoogleLoading(true);
                  try {
                    await authClient.signIn.social({
                      provider: 'google',
                      callbackURL: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
                    });
                  } catch {
                    toast.error('Google sign-up failed');
                    setGoogleLoading(false);
                  }
                }}
              >
                {!googleLoading && (
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                Continue with Google
              </Button>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground mt-5">
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
