import { formatBytes, MAX_PDF_BYTES, MAX_REQUEST_BYTES } from '@/lib/limits';

/**
 * An error with a status code and two messages: one safe to return, one for the
 * log.
 *
 * The split is the point. `publicMessage` is written for the operator of a
 * self-hosted install reading a failed send in their own logs, so it says what
 * they got wrong. `logMessage` may name internals — a provider's complaint, a
 * parser's position — and never leaves this process.
 */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly logMessage?: string,
  ) {
    super(logMessage ?? publicMessage);
    this.name = 'RelayError';
  }
}

export const badRequest = (publicMessage: string, logMessage?: string) =>
  new RelayError(400, publicMessage, logMessage);

/**
 * Deliberately says nothing about *why*. Distinguishing "no header" from "wrong
 * token" in the response tells a prober which half to work on; the log gets the
 * distinction instead.
 */
export const unauthorized = (logMessage?: string) =>
  new RelayError(401, 'Unauthorized', logMessage);

export const payloadTooLarge = (publicMessage: string, logMessage?: string) =>
  new RelayError(413, publicMessage, logMessage);

export const tooManyRequests = (retryAfterSeconds: number) =>
  new RateLimitedError(retryAfterSeconds);

/** Carries the retry hint so the route can set `Retry-After`. */
export class RateLimitedError extends RelayError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      'Too many report emails requested. Please retry shortly.',
      `Rate limit exceeded; retry after ${retryAfterSeconds}s`,
    );
    this.name = 'RateLimitedError';
  }
}

/** The one message every unexpected failure collapses into. */
export const SEND_FAILURE_MESSAGE = 'Unable to send report email';

export const pdfTooLarge = (actualBytes?: number) =>
  payloadTooLarge(
    `The report exceeds the ${formatBytes(MAX_PDF_BYTES)} attachment limit.`,
    actualBytes === undefined ? undefined : `Decoded PDF was ${actualBytes} bytes`,
  );

export const requestTooLarge = (declaredBytes?: number) =>
  payloadTooLarge(
    `The request exceeds the ${formatBytes(MAX_REQUEST_BYTES)} limit.`,
    declaredBytes === undefined ? undefined : `Declared body was ${declaredBytes} bytes`,
  );
