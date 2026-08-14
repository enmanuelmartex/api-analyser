import { redactFields } from '@/lib/logging/redact';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Derives a logger that stamps every line with additional fields. */
  child(fields: Record<string, unknown>): Logger;
}

/**
 * One JSON object per line, which is what Vercel's log drains and every log
 * aggregator want, and which keeps a request's fields queryable instead of
 * embedded in a sentence.
 *
 * Every payload passes through {@link redactFields} on the way out, so a future
 * caller that logs `{ authorization }` by mistake writes `[redacted]`.
 */
export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: 'api-analyzer-mail-relay',
      event,
      ...redactFields({ ...base, ...fields }),
    });

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** For tests and for code paths that must not log. */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
