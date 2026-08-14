import { handleSendReport } from '@/lib/relay/send-report-handler';

/**
 * `Buffer`, `node:crypto` and the Resend SDK's attachment handling all want the
 * Node runtime. The Edge runtime would also cap the body lower than the
 * attachment limit this service is built around.
 */
export const runtime = 'nodejs';

/** Nothing here is cacheable or statically analysable. */
export const dynamic = 'force-dynamic';

/**
 * Comfortably above the provider timeout in `resend-mailer.ts`, so a slow send
 * fails as a logged error rather than a killed function.
 */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleSendReport(request);
}

/**
 * No CORS headers, and no `OPTIONS` handler, on purpose.
 *
 * This endpoint is called by a self-hosted API Analyser *backend*, not by a
 * browser — that is the whole point of the relay. Calling it from a page would
 * mean shipping `RELAY_SECRET` to the browser, where it is readable by anyone
 * who opens devtools and by every script on the page. Without an
 * `Access-Control-Allow-Origin` header the browser refuses the cross-origin
 * call, which makes that mistake fail loudly instead of quietly working.
 *
 * Server-to-server callers are unaffected: CORS is a browser policy, and curl,
 * NestJS and a Vercel function have never consulted it.
 */
