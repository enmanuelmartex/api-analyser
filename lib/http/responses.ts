import { RateLimitedError, RelayError, SEND_FAILURE_MESSAGE } from '@/lib/http/errors';

export interface SuccessBody {
  success: true;
  message: string;
  emailId: string;
}

export interface ErrorBody {
  success: false;
  error: string;
}

/**
 * Every response the relay produces goes through here, which is how the shape
 * stays consistent and how `no-store` ends up on all of them — nothing this
 * service returns should ever sit in a proxy cache.
 */
function json(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonOk(body: unknown, extraHeaders?: HeadersInit): Response {
  return json(body, 200, extraHeaders);
}

export function jsonSuccess(emailId: string, message = 'Report email sent'): Response {
  return json({ success: true, message, emailId } satisfies SuccessBody, 200);
}

export function jsonError(status: number, error: string, extraHeaders?: HeadersInit): Response {
  return json({ success: false, error } satisfies ErrorBody, status, extraHeaders);
}

/**
 * Turns any thrown value into a response.
 *
 * A `RelayError` carries its own status and a message written to be read by a
 * caller. Anything else is a bug or an outage, and collapses to a single
 * generic 500 — no message, no class name, no stack. The detail belongs in the
 * log line the caller writes before calling this.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof RateLimitedError) {
    return jsonError(error.status, error.publicMessage, {
      'Retry-After': String(error.retryAfterSeconds),
    });
  }

  if (error instanceof RelayError) {
    return jsonError(error.status, error.publicMessage);
  }

  return jsonError(500, SEND_FAILURE_MESSAGE);
}
