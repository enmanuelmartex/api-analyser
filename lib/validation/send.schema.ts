import { z } from 'zod';
import { badRequest } from '@/lib/http/errors';
import {
  MAX_EMAIL_CHARS,
  MAX_FILENAME_CHARS,
  MAX_PDF_BASE64_CHARS,
  MAX_SCAN_NAME_CHARS,
} from '@/lib/limits';
import { isSafeUrl, MAX_URL_CHARS } from '@/lib/validation/url';

/** Nothing reaching a mail header may contain a line break. See send-report.schema.ts. */
const NO_NEWLINES = /^[^\r\n]*$/;

/** A failure reason is a sentence or a stack trace, not a document. */
const MAX_REASON_CHARS = 1000;

const email = z
  .string({ required_error: '`to` is required' })
  .trim()
  .max(MAX_EMAIL_CHARS, '`to` is too long')
  .regex(NO_NEWLINES, '`to` must not contain line breaks')
  .email('`to` must be a valid email address');

const displayName = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `\`${field}\` must not be blank`)
    .max(MAX_SCAN_NAME_CHARS, `\`${field}\` is too long`)
    .regex(NO_NEWLINES, `\`${field}\` must not contain line breaks`);

/**
 * A link the email may contain.
 *
 * `.url()` alone is not enough: Zod defers to `new URL`, which happily accepts
 * `javascript:alert(1)`. Without the refinement a caller's unsafe link would
 * pass validation and then be silently dropped by the renderer, leaving them
 * with a 200 and an email missing its button. `safeUrl` is the same rule the
 * renderer applies, so the two cannot disagree.
 */
const url = z
  .string()
  .trim()
  .max(MAX_URL_CHARS, 'URL is too long')
  .url('must be a valid URL')
  .refine(isSafeUrl, 'must be an http or https URL');

const count = z.number().int().min(0).max(1_000_000);

const severityCounts = z
  .object({
    critical: count,
    high: count,
    medium: count,
    low: count,
    info: count,
  })
  .strict();

const attachment = z
  .object({
    filename: z
      .string()
      .trim()
      .min(5, '`attachment.filename` is too short')
      .max(MAX_FILENAME_CHARS, '`attachment.filename` is too long')
      .regex(NO_NEWLINES, '`attachment.filename` must not contain line breaks'),
    // Coarse only. Alphabet, padding, size and magic bytes are `pdf.ts`, which
    // can tell a 400 from a 413.
    contentBase64: z
      .string()
      .min(1, '`attachment.contentBase64` must not be empty')
      .max(MAX_PDF_BASE64_CHARS * 2, '`attachment.contentBase64` is too large'),
  })
  .strict();

/**
 * The templates a caller may ask for, and exactly what each one accepts.
 *
 * A discriminated union rather than a loose `data` object: naming `scan-failed`
 * and passing a severity breakdown is a mistake worth a 400, and the alternative
 * — one permissive shape covering every template — is how a field silently stops
 * being rendered after a refactor.
 */
export const sendSchema = z.discriminatedUnion('template', [
  z
    .object({
      to: email,
      template: z.literal('scan-report'),
      data: z
        .object({
          projectName: displayName('projectName'),
          securityScore: z.number().min(0).max(100).nullable().optional(),
          counts: severityCounts.optional(),
          totalFindings: count.optional(),
          reportUrl: url.optional(),
        })
        .strict(),
      attachment: attachment.optional(),
    })
    .strict(),

  z
    .object({
      to: email,
      template: z.literal('scan-failed'),
      data: z
        .object({
          projectName: displayName('projectName'),
          reason: z
            .string()
            .trim()
            .min(1, '`reason` must not be blank')
            .max(MAX_REASON_CHARS, '`reason` is too long'),
          scanUrl: url.optional(),
          scheduleName: displayName('scheduleName').optional(),
        })
        .strict(),
      // A failed scan has no report, so there is nothing to attach and
      // accepting one would mean the template silently ignored it.
      attachment: z.undefined().optional(),
    })
    .strict(),

  z
    .object({
      to: email,
      template: z.literal('critical-finding'),
      data: z
        .object({
          projectName: displayName('projectName'),
          criticalCount: count,
          issuesUrl: url.optional(),
        })
        .strict(),
      attachment: z.undefined().optional(),
    })
    .strict(),
]);

export type SendRequest = z.infer<typeof sendSchema>;

/**
 * @throws {RelayError} 400, carrying the first field error — enough for the
 * operator to fix the call, and nothing about the server.
 */
export function parseSendRequest(input: unknown): SendRequest {
  const result = sendSchema.safeParse(input);

  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join('.');

  let message: string;
  if (issue?.code === 'unrecognized_keys') {
    message = 'Request contains unsupported fields';
  } else if (issue?.code === 'invalid_union_discriminator') {
    message = '`template` must be one of: scan-report, scan-failed, critical-finding';
  } else {
    message = issue?.message ?? 'Invalid request body';
  }

  throw badRequest(message, `validation failed at ${path || '<root>'}: ${issue?.code}`);
}
