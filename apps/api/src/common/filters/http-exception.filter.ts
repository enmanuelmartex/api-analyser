import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import { redactUrl } from '../utils/redact.util';

/**
 * Client-error codes worth recording as events.
 *
 * Not every 4xx: 401 and 404 are produced continuously by expired tokens,
 * unauthenticated probes and bookmarked URLs, and recording them would bury the
 * events an operator is actually looking for under thousands of rows a day. The
 * ones kept here each indicate something an operator would want to see — a
 * refused action, a conflicting write, a rejected payload, a client being rate
 * limited. Authentication failures are recorded by AuthService with the context
 * this filter does not have.
 */
const RECORDED_CLIENT_ERRORS = new Set([400, 403, 409, 422, 429]);

/**
 * How long an identical failure is folded into the previous event.
 *
 * Found by scanning this instance with itself: the scanner probes one route
 * hundreds of times in a few seconds, and every rejected probe wrote its own
 * row — sixteen identical validation failures inside two seconds, which pushed
 * everything else out of the live view. One event per route per window, carrying
 * how many were folded into it, says the same thing without the flood.
 */
const DUPLICATE_WINDOW_MS = 10_000;

/** Ceiling on the throttle's own memory. Bounded so it cannot become a leak. */
const MAX_TRACKED_ROUTES = 500;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Optional on purpose.
   *
   * The filter is instantiated by hand in `main.ts` rather than through DI, and
   * it must keep working — returning a correct error response — if it is ever
   * constructed without a bus, including in a unit test that news it up.
   */
  /** Last emission per `METHOD path status`, and what has been folded into it. */
  private readonly recent = new Map<string, { at: number; folded: number }>();

  constructor(private readonly events?: EventEmitter2) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // The URL may carry an SSE `?token=` credential — redact before it reaches
    // the response body or the log.
    const safeUrl = redactUrl(request.url);

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safeUrl,
      method: request.method,
      error: typeof message === 'string' ? message : (message as any).message || message,
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${safeUrl} — ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${safeUrl} — ${status}`);
    }

    /*
     * Also record it as an event.
     *
     * Until now a failing request existed only in the container's stdout, which
     * is exactly where an operator cannot see it: the product has a log
     * explorer, and "why did that call fail?" is the first question asked of it.
     *
     * Emitted rather than written directly so this filter keeps no dependency on
     * the audit module, and wrapped because an error inside error handling must
     * never replace the response the client is waiting for.
     */
    const throttle = this.events && this.shouldRecord(status)
      ? this.admit(request.method, safeUrl, status)
      : null;

    if (this.events && throttle) {
      try {
        this.events.emit('http.error', {
          method: request.method,
          route: safeUrl,
          statusCode: status,
          repeatedCount: throttle.folded,
          message: describe(errorResponse.error, status),
          errorCode: (exception as any)?.code,
          // Only for 5xx: a 403's stack is the guard that rejected it, which is
          // noise, while a 500's stack is the entire point of recording it.
          stackTrace: status >= 500 && exception instanceof Error ? exception.stack : undefined,
          userId: (request as any).user?.id,
          requestId: request.requestId,
          ipAddress: request.ip,
        });
      } catch (err) {
        this.logger.warn(`Could not emit http.error event: ${(err as Error).message}`);
      }
    }

    response.status(status).json(errorResponse);
  }

  private shouldRecord(status: number): boolean {
    return status >= 500 || RECORDED_CLIENT_ERRORS.has(status);
  }

  /**
   * Decides whether this failure gets its own event.
   *
   * Returns the number of identical failures folded into it since the last one
   * was emitted, or `null` to stay silent. Keyed on the path without its query
   * string, so `?page=2` and `?page=3` failing the same way are one problem.
   *
   * Deliberately per-process and approximate. It exists to stop a burst from
   * drowning the log, not to count precisely — the response the client receives
   * is unaffected either way, and the ledger of record is the row.
   */
  private admit(method: string, url: string, status: number): { folded: number } | null {
    const key = `${method} ${url.split('?')[0]} ${status}`;
    const now = Date.now();
    const seen = this.recent.get(key);

    if (seen && now - seen.at < DUPLICATE_WINDOW_MS) {
      seen.folded += 1;
      return null;
    }

    const folded = seen?.folded ?? 0;
    this.recent.set(key, { at: now, folded: 0 });

    if (this.recent.size > MAX_TRACKED_ROUTES) {
      for (const [entry, value] of this.recent) {
        if (now - value.at >= DUPLICATE_WINDOW_MS) this.recent.delete(entry);
      }
      // Still over the ceiling after evicting everything expired: the instance
      // is failing on more distinct routes than the throttle tracks, so start
      // over rather than grow without bound.
      if (this.recent.size > MAX_TRACKED_ROUTES) this.recent.clear();
    }

    return { folded };
  }
}

/**
 * A one-line description of what went wrong.
 *
 * ValidationPipe reports an array of field messages rather than a string, which
 * is why this is not a plain cast: without the array branch, every rejected
 * payload — the single most useful 4xx to record — was logged as the generic
 * "Request rejected" with the actual reason discarded.
 */
function describe(error: unknown, status: number): string {
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.filter((entry) => typeof entry === 'string').join('; ');
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return status >= 500 ? 'Internal server error' : 'Request rejected';
}
