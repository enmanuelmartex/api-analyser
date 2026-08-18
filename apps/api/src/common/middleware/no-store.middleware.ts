import type { NextFunction, Request, Response } from 'express';

/**
 * `Cache-Control: no-store` on every `/api/v1/*` response.
 *
 * Plain middleware rather than an interceptor, specifically so it also
 * applies to a response an exception filter sends. An `@nestjs/common`
 * interceptor's `tap`/`map` only runs on the success path — a route rejected
 * by a guard (401/403) or by the throttler (429) throws before any
 * interceptor gets a chance to run, so an interceptor-based version would
 * cover a 200 but not the 401 the scanner also checked for. Middleware runs
 * before guards, pipes and the exception filter alike, and the header it sets
 * survives whatever later code writes the actual response body.
 *
 * Scoped to `/api/v1` — not `/api/auth` (Better Auth serves that; caching a
 * session-establishing response is a different question this API does not
 * own) and not `/api/docs` (Swagger's static assets legitimately benefit from
 * caching, and carry no per-user data).
 *
 * `no-store` rather than `no-cache`/`private`: this API is a security
 * scanner whose every authenticated response can carry vulnerability data,
 * credentials-adjacent configuration, or another tenant's project details if
 * a caching layer ever got the isolation wrong. `no-store` forbids storing
 * the response at all — in a browser's disk cache, a shared proxy, or a CDN —
 * rather than merely requiring revalidation, which is the stronger
 * instruction the scanner's own "Missing Security Header: Cache-Control"
 * check evaluates against.
 */
export function noStoreForApi() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl?.startsWith('/api/v1')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  };
}
