import { redactHttpMessage, redactObject, redactUrl } from '../../common/utils/redact.util';
import type { LogEventInput } from './log-event.types';

/**
 * Strips credentials out of an event before it is written.
 *
 * Applied inside AuditService rather than at each call site, because "remember
 * to redact" is a rule that gets forgotten exactly once and then the secret is
 * in the database forever. Every field that can carry attacker- or
 * operator-supplied text goes through it:
 *
 *   • metadata   — arbitrary payload, redacted key-wise and recursively
 *   • message    — free text; may quote a header or a URL
 *   • route      — SSE authenticates via `?token=`, so URLs carry live JWTs
 *   • userAgent  — attacker-controlled, and unbounded
 *   • stackTrace — frames can embed a request URL or an interpolated secret
 *
 * The existing redaction utilities are reused rather than reimplemented: they
 * already back the scanner's evidence redaction and are covered by tests, so
 * there is one definition of "sensitive" across the product.
 */

/** Caps that keep one hostile event from dominating the table. */
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_STACK_TRACE_LENGTH = 8_000;
const MAX_METADATA_BYTES = 16_000;

function truncate(value: string | undefined, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}… [truncated]` : value;
}

export function sanitizeLogEvent(input: LogEventInput): LogEventInput {
  return {
    ...input,
    message: truncate(redactHttpMessage(input.message), MAX_MESSAGE_LENGTH),
    route: input.route ? redactUrl(input.route) : undefined,
    userAgent: truncate(input.userAgent, MAX_USER_AGENT_LENGTH),
    stackTrace: truncate(redactHttpMessage(input.stackTrace), MAX_STACK_TRACE_LENGTH),
    metadata: sanitizeMetadata(input.metadata),
  };
}

/**
 * Redacts and size-caps the metadata payload.
 *
 * Oversized metadata is replaced by a marker rather than truncated as a string:
 * half a JSON document is not JSON, and a viewer that cannot parse it shows the
 * operator nothing at all.
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const redacted = redactObject(metadata);
  let serialised: string;
  try {
    serialised = JSON.stringify(redacted);
  } catch {
    // Cyclic or otherwise non-serialisable input. Recording that it could not be
    // stored is more useful than dropping the event.
    return { _error: 'metadata could not be serialised' };
  }

  if (serialised.length > MAX_METADATA_BYTES) {
    return {
      _truncated: true,
      _originalBytes: serialised.length,
      _note: `Metadata exceeded ${MAX_METADATA_BYTES} bytes and was not stored.`,
    };
  }

  return redacted as Record<string, unknown>;
}
