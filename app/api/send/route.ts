import { handleSend } from '@/lib/relay/send-handler';

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
  return handleSend(request);
}

/**
 * No CORS headers, and no `OPTIONS` handler — see the note in
 * `app/api/send-report/route.ts`. This endpoint is called by a self-hosted API
 * Analyser backend, never by a browser.
 */
