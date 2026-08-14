import { ConfigurationError } from '@/lib/config/env';
import {
  badRequest,
  RelayError,
  requestTooLarge,
  SEND_FAILURE_MESSAGE,
  tooManyRequests,
  unauthorized,
} from '@/lib/http/errors';
import { errorResponse, jsonError, jsonSuccess } from '@/lib/http/responses';
import { MAX_REQUEST_BYTES } from '@/lib/limits';
import type { Logger } from '@/lib/logging/logger';
import { maskEmail } from '@/lib/logging/redact';
import { getRelayDependencies, type RelayDependencies } from '@/lib/relay/dependencies';
import type { OutboundAttachment } from '@/lib/resend/mailer';

export interface RelayContext {
  readonly deps: RelayDependencies;
  readonly log: Logger;
  /** Stable id of the authenticated caller. Safe to log. */
  readonly clientId: string;
}

/**
 * Everything both endpoints do before they differ, and the single place errors
 * are turned into responses.
 *
 * The order of the steps is load-bearing:
 *
 *   1. **Authenticate first.** Nothing expensive happens for an anonymous
 *      caller, and anonymous requests never consume an authenticated caller's
 *      rate-limit budget.
 *   2. **Size before reading.** `Content-Length` is checked before the body is
 *      pulled off the socket, so a 40 MB payload costs a header parse.
 *   3. **Rate limit before parsing.** Base64 decoding a few megabytes is the
 *      most expensive thing here; a caller over their limit should not get it.
 *
 * `handle` receives the parsed JSON and may throw any `RelayError`; the status
 * it carries becomes the response, and anything else collapses to a generic
 * 500 with the detail confined to the log.
 */
export async function runRelayRequest(
  request: Request,
  injected: RelayDependencies | undefined,
  handle: (body: unknown, context: RelayContext) => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  let deps: RelayDependencies;
  try {
    deps = injected ?? getRelayDependencies();
  } catch (error) {
    // A deployment problem. The variable *names* are safe to log and are what
    // an operator needs; their values never appear anywhere.
    if (error instanceof ConfigurationError) {
      console.error(
        JSON.stringify({
          level: 'error',
          time: new Date().toISOString(),
          service: 'api-analyzer-mail-relay',
          event: 'config.missing',
          requestId,
          missing: error.missing,
        }),
      );
      return jsonError(500, 'Mail relay is not configured');
    }
    throw error;
  }

  const log = deps.logger.child({ requestId });

  try {
    log.info('request.received', {
      // Deliberately not the body, the recipient, or any header.
      contentLength: request.headers.get('content-length') ?? undefined,
    });

    const auth = await deps.authenticator.authenticate(request);
    if (!auth.ok) {
      log.warn('auth.rejected', { reason: auth.reason, scheme: deps.authenticator.scheme });
      throw unauthorized(auth.reason);
    }
    const { clientId } = auth.context;

    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      log.warn('request.too_large', { clientId, declaredBytes: declared });
      throw requestTooLarge(declared);
    }

    const limits = auth.context.rateLimit ?? deps.config.rateLimit;
    const decision = await deps.rateLimiter.consume(clientId, limits.max, limits.windowSeconds);
    if (!decision.allowed) {
      log.warn('rate_limit.exceeded', {
        clientId,
        limit: decision.limit,
        limiter: deps.rateLimiter.name,
      });
      throw tooManyRequests(decision.retryAfterSeconds);
    }

    const raw = await readBody(request);
    if (raw.length > MAX_REQUEST_BYTES) {
      // A chunked request arrives without a usable `Content-Length`, so the
      // ceiling is enforced a second time against what actually turned up.
      log.warn('request.too_large', { clientId, actualBytes: raw.length });
      throw requestTooLarge(raw.length);
    }

    return await handle(parseJson(raw), { deps, log, clientId });
  } catch (error) {
    if (error instanceof RelayError) {
      // Already classified, and already logged where it was raised with more
      // context than is available here.
      return errorResponse(error);
    }

    // Anything reaching here is a bug. The stack goes to the log; the caller
    // gets one sentence.
    log.error('request.unhandled_error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse(error);
  }
}

export interface DeliveryInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly OutboundAttachment[];
  /** For logs, so a delivery can be traced to the message that produced it. */
  readonly template: string;
}

/**
 * Hands a rendered message to the provider and turns the outcome into a
 * response.
 *
 * The failure branch is the interesting one: the provider's own words go to the
 * log and never to the caller, who gets the single generic message. A provider
 * complaint can name an unverified domain, an account state or an internal
 * host, none of which is the caller's business.
 */
export async function deliver(context: RelayContext, input: DeliveryInput): Promise<Response> {
  const { deps, log, clientId } = context;

  log.info('email.sending', {
    clientId,
    recipient: maskEmail(input.to),
    template: input.template,
    attachmentBytes: input.attachments?.[0]?.content.length,
    provider: deps.mailer.provider,
  });

  const result = await deps.mailer.send({
    from: deps.config.emailFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments ?? [],
  });

  if (!result.ok) {
    log.error('email.failed', {
      clientId,
      recipient: maskEmail(input.to),
      template: input.template,
      provider: deps.mailer.provider,
      reason: result.reason,
      retryable: result.retryable,
    });
    return jsonError(500, SEND_FAILURE_MESSAGE);
  }

  log.info('email.sent', {
    clientId,
    recipient: maskEmail(input.to),
    template: input.template,
    provider: deps.mailer.provider,
    emailId: result.id,
  });

  return jsonSuccess(result.id);
}

async function readBody(request: Request): Promise<string> {
  try {
    return await request.text();
  } catch (error) {
    throw badRequest(
      'Request body could not be read',
      `body read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseJson(raw: string): unknown {
  if (raw.trim().length === 0) {
    throw badRequest('Request body is empty');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    // The parser's message can quote the offending input, which may be a
    // fragment of a PDF. Only the position survives into the log.
    throw badRequest(
      'Request body is not valid JSON',
      `JSON.parse failed: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`,
    );
  }
}
