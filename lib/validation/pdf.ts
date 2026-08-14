import { badRequest, pdfTooLarge } from '@/lib/http/errors';
import { formatBytes, MAX_PDF_BASE64_CHARS, MAX_PDF_BYTES, MIN_PDF_BYTES } from '@/lib/limits';

/** Standard base64, padding optional-but-correct. No URL-safe alphabet. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `data:application/pdf;base64,` — tolerated because clients emit it by accident. */
const DATA_URL_PREFIX = /^data:application\/pdf;base64,/i;

/** Every PDF starts with this. */
const PDF_MAGIC = '%PDF-';

/**
 * Turns the caller's `pdfBase64` into bytes, or explains why it will not.
 *
 * The order of the checks is the interesting part, and it is deliberate:
 *
 *   1. **Length before decoding.** A 40 MB string is rejected as a string.
 *      Decoding first would allocate 30 MB to learn the same thing.
 *   2. **Alphabet before decoding.** `Buffer.from(x, 'base64')` silently skips
 *      characters it does not recognise, so `"not base64 at all!"` decodes to a
 *      short buffer instead of failing. Without this check the caller gets a
 *      corrupt attachment rather than a 400.
 *   3. **Magic bytes after decoding.** Valid base64 of a valid *something else*
 *      passes every check above. The relay attaches files named `.pdf` to mail
 *      sent from a verified security domain; it should be sure they are PDFs.
 *
 * @throws {RelayError} 400 for malformed input, 413 for oversized input.
 */
export function decodePdfBase64(value: string): Buffer {
  const payload = value.trim().replace(DATA_URL_PREFIX, '');

  if (payload.length === 0) {
    throw badRequest('`pdfBase64` must not be empty');
  }

  if (payload.length > MAX_PDF_BASE64_CHARS) {
    throw pdfTooLarge();
  }

  if (payload.length % 4 !== 0 || !BASE64.test(payload)) {
    throw badRequest(
      '`pdfBase64` is not valid base64',
      `base64 payload failed alphabet/padding check (${payload.length} chars)`,
    );
  }

  const buffer = Buffer.from(payload, 'base64');

  if (buffer.length < MIN_PDF_BYTES) {
    throw badRequest(
      'The decoded report is too small to be a PDF',
      `decoded ${buffer.length} bytes, minimum ${MIN_PDF_BYTES}`,
    );
  }

  if (buffer.length > MAX_PDF_BYTES) {
    throw pdfTooLarge(buffer.length);
  }

  if (buffer.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw badRequest(
      'The decoded report is not a PDF',
      'decoded payload did not begin with %PDF-',
    );
  }

  return buffer;
}

/** For the README and for error copy, so the documented limit has one source. */
export const PDF_LIMIT_DESCRIPTION = `${formatBytes(MAX_PDF_BYTES)} decoded (~${formatBytes(
  MAX_PDF_BASE64_CHARS,
)} of base64)`;
