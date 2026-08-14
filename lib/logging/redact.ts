/**
 * Two independent guards against a secret reaching a log aggregator.
 *
 * Neither is meant to be the only one. Call sites are written not to pass
 * secrets in the first place; these exist because "written not to" is a claim
 * about every future edit, and this file is a fact about the current one.
 */

/**
 * Names that carry a payload rather than a fact about one, matched as whole
 * keys.
 *
 * Whole keys, not substrings, because the useful log fields live right next to
 * the forbidden ones: `pdfBytes` is the size of the attachment and belongs in
 * the log, `pdf` is the attachment and does not. A substring rule redacts both
 * and quietly makes the logs useless.
 */
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'auth',
  'bearer',
  'cookie',
  'pdf',
  'pdfbase64',
  'attachment',
  'attachments',
  'content',
  'contents',
  'html',
  'body',
  'payload',
  'raw',
]);

/**
 * Names that are unsafe wherever they appear, because no prefix or suffix makes
 * them safe: `relaySecret`, `RESEND_API_KEY`, `installToken` are all the thing
 * itself.
 */
const FORBIDDEN_KEY_PATTERN =
  /(secret|token|password|passphrase|credential|api[-_]?key|private[-_]?key)/i;

export const REDACTED = '[redacted]';

function isForbidden(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase()) || FORBIDDEN_KEY_PATTERN.test(key);
}

/**
 * Strips forbidden keys from a flat log payload.
 *
 * Shallow by design: log fields are flat here, and a recursive walk over
 * attacker-influenced data is a denial-of-service shape rather than a safety
 * feature.
 */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = isForbidden(key) ? REDACTED : value;
  }
  return safe;
}

/**
 * Removes known secret values from free text.
 *
 * For provider errors, which are strings we did not write and cannot audit:
 * Resend does not echo the API key back today, and the cost of being wrong
 * about that once is a live credential sitting in a log forever.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let output = text;
  for (const secret of secrets) {
    // Short strings would match everywhere and turn the message to noise.
    if (!secret || secret.length < 8) continue;
    output = output.split(secret).join(REDACTED);
  }
  return output;
}

/**
 * `ab****@example.com` — enough to correlate a delivery complaint with a log
 * line, not enough to harvest an address list out of log storage.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '[invalid address]';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(local.length - head.length, 1))}@${domain}`;
}
