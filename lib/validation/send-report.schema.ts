import { z } from 'zod';
import { badRequest } from '@/lib/http/errors';
import {
  MAX_EMAIL_CHARS,
  MAX_FILENAME_CHARS,
  MAX_PDF_BASE64_CHARS,
  MAX_SCAN_NAME_CHARS,
} from '@/lib/limits';

/**
 * Nothing that reaches a mail header may contain a line break. A newline in a
 * subject or an address is header injection — the classic way to append a `Bcc`
 * to somebody else's message.
 */
const NO_NEWLINES = /^[^\r\n]*$/;

export const sendReportSchema = z
  .object({
    email: z
      .string({ required_error: '`email` is required' })
      .trim()
      .max(MAX_EMAIL_CHARS, '`email` is too long')
      .regex(NO_NEWLINES, '`email` must not contain line breaks')
      .email('`email` must be a valid email address'),

    scanName: z
      .string()
      .trim()
      .min(1, '`scanName` must not be blank')
      .max(MAX_SCAN_NAME_CHARS, '`scanName` is too long')
      .regex(NO_NEWLINES, '`scanName` must not contain line breaks')
      .optional(),

    filename: z
      .string({ required_error: '`filename` is required' })
      .trim()
      .min(5, '`filename` is too short')
      .max(MAX_FILENAME_CHARS, '`filename` is too long')
      .regex(NO_NEWLINES, '`filename` must not contain line breaks'),

    // Only the coarse checks here. Alphabet, padding, size and magic bytes are
    // `lib/validation/pdf.ts`, which can tell 400 from 413 — a distinction Zod
    // has no way to express.
    pdfBase64: z
      .string({ required_error: '`pdfBase64` is required' })
      .min(1, '`pdfBase64` must not be empty')
      .max(MAX_PDF_BASE64_CHARS * 2, '`pdfBase64` is too large'),
  })
  // Unknown keys are rejected rather than ignored. A caller sending `html` or
  // `from` or `bcc` has misunderstood what this service does, and silently
  // dropping the field would let them believe it worked.
  .strict();

export type SendReportRequest = z.infer<typeof sendReportSchema>;

/**
 * @throws {RelayError} 400, carrying the first field error as its public
 * message — enough for the operator to fix the call, and nothing about the
 * server.
 */
export function parseSendReportRequest(input: unknown): SendReportRequest {
  const result = sendReportSchema.safeParse(input);

  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join('.');
  const message =
    issue?.code === 'unrecognized_keys'
      ? 'Request contains unsupported fields'
      : (issue?.message ?? 'Invalid request body');

  throw badRequest(message, `validation failed at ${path || '<root>'}: ${issue?.code}`);
}
