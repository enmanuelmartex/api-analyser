/**
 * The one place the API's CORS origin allowlist is computed.
 *
 * Before this, three independent call sites each read `process.env.FRONTEND_URL`
 * directly and each hardcoded its own fallback: the manual CORS shim for
 * `/api/auth/*` in `main.ts`, the real `app.enableCors` call for `/api/v1/*` in
 * the same file, and Better Auth's own `trustedOrigins` in `lib/auth.ts`. All
 * three only ever supported a single origin, so a deployment with more than one
 * legitimate frontend (a marketing site plus an app subdomain, a staging and a
 * production URL) had no way to configure it without one of the three going
 * stale relative to the others.
 */

/** Comma-separated additional origins, on top of (or instead of) FRONTEND_URL. */
const ORIGINS_ENV_VAR = 'CORS_ALLOWED_ORIGINS';

/**
 * The configured allowlist of trusted frontend origins.
 *
 * `CORS_ALLOWED_ORIGINS` is authoritative when set — a comma-separated list,
 * e.g. `https://app.example.com,https://staging.example.com`. When it is not
 * set, `FRONTEND_URL` (already required by every existing deployment) is used
 * alone, so a single-origin install needs no new configuration.
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env[ORIGINS_ENV_VAR]?.trim();
  const origins = explicit
    ? explicit.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [env.FRONTEND_URL?.trim() || 'http://localhost:3000'];

  // De-duplicated and stripped of a trailing slash — an operator pasting a URL
  // from a browser address bar commonly includes one, and `Origin` headers
  // never do, so a trailing slash would silently make every request fail the
  // allowlist check.
  return [...new Set(origins.map((origin) => origin.replace(/\/$/, '')))];
}

/** Whether `origin` (an incoming `Origin` header value) is on the allowlist. */
export function isOriginAllowed(origin: string | undefined | null, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.includes(origin.replace(/\/$/, ''));
}
