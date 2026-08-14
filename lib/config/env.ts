/**
 * Reads configuration once, from `process.env`, and never anywhere else.
 *
 * Two rules hold everywhere below: a secret's *value* is never returned in an
 * error, logged, or included in a response — only its variable *name* is, which
 * is what an operator needs to fix a broken deployment.
 */

/** Verified sender used when `EMAIL_FROM` is unset. */
export const DEFAULT_EMAIL_FROM = 'API Analyzer <reports@notifications.apianalyser.com>';

/**
 * Where the logo in an email is fetched from.
 *
 * This deployment's own public origin, because the images live in this
 * project's `public/brand/` and are therefore versioned and deployed with the
 * templates that reference them. Pointing it at the marketing site instead
 * would make every email in every install depend on a separate deployment's
 * asset paths.
 *
 * It must be an absolute `https://` origin. A mail client will not resolve a
 * relative path — there is no page for it to be relative to — and most refuse
 * to load `http://` at all, so a `localhost` value renders as a broken image.
 */
export const DEFAULT_ASSET_BASE_URL = 'https://mail.apianalyser.com';

/** Defaults for the abuse limiter. Overridable, but sane for a single install. */
export const DEFAULT_RATE_LIMIT_MAX = 20;
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

export interface RelayConfig {
  /** Resend credential. Held in memory only; never logged, never returned. */
  readonly resendApiKey: string;
  /** Shared bearer token callers must present. Same handling as above. */
  readonly relaySecret: string;
  /** RFC 5322 sender, e.g. `API Analyzer <reports@…>`. */
  readonly emailFrom: string;
  /** Absolute origin the email logo is loaded from. No trailing slash. */
  readonly assetBaseUrl: string;
  readonly rateLimit: {
    readonly max: number;
    readonly windowSeconds: number;
    /** Both present ⇒ the distributed limiter is used. */
    readonly upstashUrl?: string;
    readonly upstashToken?: string;
  };
}

/**
 * A deployment problem, not a request problem: the caller did nothing wrong and
 * retrying will not help until an operator sets the variable.
 */
export class ConfigurationError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Missing required environment variable(s): ${missing.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(env: Env, name: string, fallback: number): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @throws {ConfigurationError} when a required variable is missing.
 *
 * `RELAY_SECRET` is required rather than optional on purpose. Treating an unset
 * secret as "no auth needed" is exactly how a relay becomes an open one, so the
 * service refuses to serve at all instead.
 */
export function loadConfig(env: Env = process.env): RelayConfig {
  const resendApiKey = read(env, 'RESEND_API_KEY');
  const relaySecret = read(env, 'RELAY_SECRET');

  const missing: string[] = [];
  if (!resendApiKey) missing.push('RESEND_API_KEY');
  if (!relaySecret) missing.push('RELAY_SECRET');
  if (missing.length > 0) throw new ConfigurationError(missing);

  const upstashUrl = read(env, 'UPSTASH_REDIS_REST_URL');
  const upstashToken = read(env, 'UPSTASH_REDIS_REST_TOKEN');

  return {
    resendApiKey: resendApiKey as string,
    relaySecret: relaySecret as string,
    emailFrom: read(env, 'EMAIL_FROM') ?? DEFAULT_EMAIL_FROM,
    // Trailing slashes stripped here so every caller can concatenate a path
    // beginning with `/` without producing a `//` that some proxies 301.
    assetBaseUrl: (read(env, 'EMAIL_ASSET_BASE_URL') ?? DEFAULT_ASSET_BASE_URL).replace(/\/+$/, ''),
    rateLimit: {
      max: readPositiveInt(env, 'RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
      windowSeconds: readPositiveInt(
        env,
        'RATE_LIMIT_WINDOW_SECONDS',
        DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      ),
      // Only useful as a pair; one without the other is a misconfiguration that
      // silently falls back rather than failing a send.
      ...(upstashUrl && upstashToken ? { upstashUrl, upstashToken } : {}),
    },
  };
}
