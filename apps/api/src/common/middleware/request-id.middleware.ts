import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/** Header carrying the correlation id, in and out. */
export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express' {
  interface Request {
    /** Correlation id for this request. Always set by RequestIdMiddleware. */
    requestId?: string;
  }
}

/**
 * Assigns every request a correlation id.
 *
 * An inbound `x-request-id` is honoured so a reverse proxy or an upstream
 * caller can propagate its own id and have both sides of a trace agree.
 * Untrusted input, so it is length-capped and stripped of anything that is not
 * safe in a header or a log line — an unbounded client-supplied value would be
 * written verbatim into every event the request produces.
 *
 * The id is echoed back on the response so an operator looking at a failed call
 * in the browser's network tab can paste it straight into the log search.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId = sanitizeInboundId(inbound) ?? `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

function sanitizeInboundId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._:-]/g, '');
  if (cleaned.length < 4 || cleaned.length > 128) return undefined;
  return cleaned;
}
