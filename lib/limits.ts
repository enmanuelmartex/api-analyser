/**
 * Size ceilings, in one place because three different layers need to agree on
 * them and a mismatch shows up as a confusing error rather than a 413.
 *
 * The binding constraint is Vercel: a serverless function receives at most
 * ~4.5 MB of request body, and the platform rejects anything larger before our
 * code runs. Base64 costs 4 characters per 3 bytes, so a PDF is ~33% bigger on
 * the wire than on disk. Working backwards from 4.5 MB:
 *
 *   3 MiB PDF  ->  4 MiB of base64  ->  ~4.01 MB of JSON  ->  fits, with room
 *
 * Reports above the ceiling are a real case (a large scan with screenshots),
 * and the answer is not a bigger number here — see README → Large reports for
 * the blob-storage path this is deliberately shaped to accept later.
 */

/** Largest PDF the relay will attach, measured after decoding. */
export const MAX_PDF_BYTES = 3 * 1024 * 1024;

/** Smallest thing that could plausibly be a PDF. Catches empty/truncated uploads. */
export const MIN_PDF_BYTES = 32;

/**
 * Longest `pdfBase64` string accepted, checked before decoding so an oversized
 * payload is rejected without allocating a buffer for it.
 */
export const MAX_PDF_BASE64_CHARS = Math.ceil(MAX_PDF_BYTES / 3) * 4;

/**
 * Hard ceiling on the whole JSON body, checked against `Content-Length` before
 * the body is read at all. Sits under Vercel's own limit so that an oversized
 * request gets our JSON 413 rather than the platform's opaque one.
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024 + 512 * 1024;

/** Field ceilings, enforced by the schema. */
export const MAX_EMAIL_CHARS = 320;
export const MAX_SCAN_NAME_CHARS = 200;
export const MAX_FILENAME_CHARS = 255;

/**
 * A person's display name, matching the 80-character ceiling the API enforces
 * on `User.name`. Kept in step deliberately: a name the application accepts
 * must not be rejected here, or a user with a long name silently stops
 * receiving mail.
 */
export const MAX_USER_NAME_CHARS = 80;

/** A failure reason is a sentence or a stack trace, not a document. */
export const MAX_REASON_CHARS = 1000;

/** Human-readable form for error messages and docs. */
export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB`;
}
