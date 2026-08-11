'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { authClient } from '@/lib/auth-client';
import { authApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { appBrand } from '@/lib/brand';
import { BrandLogo } from '@/components/brand/brand-logo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Per-field error state — only shown after the user has interacted with the field
  const [emailError, setEmailError] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);

  function validateEmail(value: string): string {
    if (!value) return 'Email is required';
    if (!EMAIL_RE.test(value)) return 'Invalid email format';
    return '';
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    // Clear error in real time once the user fixes the value
    if (emailTouched) setEmailError(validateEmail(value));
  }

  function handleEmailBlur() {
    setEmailTouched(true);
    setEmailError(validateEmail(email));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Run validation on submit in case fields were never blurred
    const err = validateEmail(email);
    setEmailTouched(true);
    setEmailError(err);
    if (err) return;

    setLoading(true);
    try {
      // Use Better Auth for email/password sign-in (bearer plugin returns token in body)
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message);
      const sessionToken = (result.data as any)?.session?.token ?? (result.data as any)?.token;
      if (!sessionToken) throw new Error('No session token received');
      const data = await authApi.exchangeSession(sessionToken);
      localStorage.setItem('api_analyser_token', data.accessToken);
      localStorage.setItem('api_analyser_user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.message || err.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo type="horizontal" size={48} />
          <p className="text-sm text-muted-foreground">{appBrand.tagline}</p>
        </div>

        {/* Card. The hairline along its top edge is the only decorative use of
            the core gradient on this screen. */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card p-8 shadow-sm">
          <span className="brand-rule absolute inset-x-0 top-0 h-px" aria-hidden="true" />
          <h1 className="mb-1 text-xl font-semibold text-foreground">Welcome back</h1>
          <p className="mb-6 text-sm text-muted-foreground">Sign in to your security dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="analyst@company.com"
                autoComplete="email"
                aria-invalid={!!(emailError && emailTouched)}
                className={cn(emailError && emailTouched && 'border-destructive focus-visible:ring-destructive')}
              />
              {emailError && emailTouched && <p className="text-xs text-destructive">{emailError}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
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
            </div>

            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-5">
            No account yet?{' '}
            <Link href="/register" className="text-primary hover:underline">
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6">
          Use only on authorized APIs and approved testing environments
        </p>
      </div>
    </div>
  );
}
