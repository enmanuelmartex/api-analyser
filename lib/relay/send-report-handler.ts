import { ConfigurationError } from '@/lib/config/env';
import { buildReportEmail } from '@/lib/email/report-email';
import {
  badRequest,
  RelayError,
  requestTooLarge,
  SEND_FAILURE_MESSAGE,
  tooManyRequests,
  unauthorized,
} from '@/lib/http/errors';
import { errorResponse, jsonError, jsonSuccess } from '@/lib/http/responses';
import { maskEmail } from '@/lib/logging/redact';
import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { getRelayDependencies, type RelayDependencies } from '@/lib/relay/dependencies';
import { sanitiseFilename } from '@/lib/validation/filename';
import { decodePdfBase64 } from '@/lib/validation/pdf';
import { parseSendReportRequest } from '@/lib/validation/send-report.schema';

/**
 * The whole of `POST /api/send-report`, minus the routing.
 *
 * Living here rather than in `route.ts` is what makes it testable as a plain
 * function: the tests call it with a `Request` and a set of fakes, and get a
 * `Response` back, with no Next.js server and no provider anywhere in the loop.
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
 *   4. **Validate before sending.** Obvious, but note that every one of those
 *      checks throws a `RelayError` carrying its own status, which is why this
 *      function has one `catch` rather than a ladder of early returns.
 */
export async function handleSendReport(
  request: Request,
  injected?: RelayDependencies,
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
      // Deliberately not the body, the recipient, or any header. The recipient
      // is logged once below, masked, after it has been validated.
      contentLength: request.headers.get('content-length') ?? undefined,
    });

    // 1. Who is calling?
    const auth = await deps.authenticator.authenticate(request);
    if (!auth.ok) {
      log.warn('auth.rejected', { reason: auth.reason, scheme: deps.authenticator.scheme });
      throw unauthorized(auth.reason);
    }
    const { clientId } = auth.context;

    // 2. Is it plausibly the right size?
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      log.warn('request.too_large', { clientId, declaredBytes: declared });
      throw requestTooLarge(declared);
    }

    // 3. Has this caller had enough for now?
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

    // 4. Is the body well-formed?
    const raw = await readBody(request);
    if (raw.length > MAX_REQUEST_BYTES) {
      // A chunked request arrives without a usable `Content-Length`, so the
      // ceiling is enforced a second time against what actually turned up.
      log.warn('request.too_large', { clientId, actualBytes: raw.length });
      throw requestTooLarge(raw.length);
    }

    const payload = parseSendReportRequest(parseJson(raw));
    const filename = sanitiseFilename(payload.filename);
    const pdf = decodePdfBase64(payload.pdfBase64);

    // 5. Build the message. Every part of it comes from this server except the
    //    recipient, the scan name and the bytes.
    const { subject, html, text } = buildReportEmail({ scanName: payload.scanName, filename });

    log.info('email.sending', {
      clientId,
      recipient: maskEmail(payload.email),
      filename,
      pdfBytes: pdf.length,
      hasScanName: payload.scanName !== undefined,
      provider: deps.mailer.provider,
    });

    const result = await deps.mailer.send({
      from: deps.config.emailFrom,
      to: payload.email,
      subject,
      html,
      text,
      attachments: [{ filename, content: pdf }],
    });

    if (!result.ok) {
      log.error('email.failed', {
        clientId,
        recipient: maskEmail(payload.email),
        provider: deps.mailer.provider,
        reason: result.reason,
        retryable: result.retryable,
      });
      return jsonError(500, SEND_FAILURE_MESSAGE);
    }

    log.info('email.sent', {
      clientId,
      recipient: maskEmail(payload.email),
      provider: deps.mailer.provider,
      emailId: result.id,
      pdfBytes: pdf.length,
    });

    return jsonSuccess(result.id);
  } catch (error) {
    if (error instanceof RelayError) {
      // Already classified and already logged at the point it was raised, with
      // more context than is available here.
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
