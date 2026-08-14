import { z } from 'zod';
import { badRequest } from '@/lib/http/errors';
import {
  MAX_EMAIL_CHARS,
  MAX_FILENAME_CHARS,
  MAX_PDF_BASE64_CHARS,
  MAX_REASON_CHARS,
  MAX_SCAN_NAME_CHARS,
  MAX_USER_NAME_CHARS,
} from '@/lib/limits';
import { isSafeUrl, MAX_URL_CHARS } from '@/lib/validation/url';

/**
 * What a caller is allowed to say.
 *
 * ── The one rule this file enforces ─────────────────────────────────────────
 *
 * A caller names a template and supplies typed values for it. Everything a
 * recipient actually sees that is NOT one of those values — the subject, the
 * markup, the sender, the logo, the colours, the footer — is decided by this
 * server. There is deliberately no field for `html`, `text`, `subject`, `from`,
 * `replyTo`, `cc`, `bcc` or `headers`, and `.strict()` on every object means a
 * request carrying one is rejected with a 400 rather than having it ignored.
 *
 * Silently dropping an unknown field would be the worse failure: the caller
 * gets a 200 and believes their `html` was used.
 *
 * A discriminated union rather than one permissive `data` object, so that
 * naming `scan-failed` and passing a severity breakdown is a 400 — and so that
 * a field cannot silently stop being rendered after a refactor.
 */

/**
 * Nothing that reaches a mail header may contain a line break.
 *
 * A newline in a subject or an address is header injection — the classic way to
 * append a `Bcc` to someone else's message. The subject is server-owned here so
 * the exposure is smaller than usual, but the recipient address is not, and
 * defence at the boundary costs one regex.
 */
const NO_NEWLINES = /^[^\r\n]*$/;

const email = z
  .string({ required_error: '`to` is required' })
  .trim()
  .max(MAX_EMAIL_CHARS, '`to` is too long')
  .regex(NO_NEWLINES, '`to` must not contain line breaks')
  .email('`to` must be a valid email address');

const displayName = (field: string, max = MAX_SCAN_NAME_CHARS) =>
  z
    .string()
    .trim()
    .min(1, `\`${field}\` must not be blank`)
    .max(max, `\`${field}\` is too long`)
    .regex(NO_NEWLINES, `\`${field}\` must not contain line breaks`);

/** The recipient's display name. Optional: a team mailbox is not a person. */
const userName = displayName('userName', MAX_USER_NAME_CHARS).optional();

/**
 * A link the email may contain.
 *
 * `.url()` alone is not enough: Zod defers to `new URL`, which happily accepts
 * `javascript:alert(1)` and `data:text/html,…`. Without the refinement an
 * unsafe link would pass validation and then be silently dropped by the
 * renderer, leaving the caller with a 200 and an email missing its button.
 * `isSafeUrl` is the same rule the renderer applies, so the two cannot disagree.
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

/**
 * Which palette to render into.
 *
 * An enum of exactly two, and neither is `system`: "follow the OS" is a
 * question only a browser can answer, and by the time a message is being
 * rendered there is no browser. The API resolves `system` to a concrete value
 * against the user's stored preference before it calls.
 */
const theme = z.enum(['light', 'dark'], {
  errorMap: () => ({ message: '`theme` must be either "light" or "dark"' }),
});

/**
 * A calendar date, `YYYY-MM-DD`.
 *
 * No time and no offset, on purpose — see `lib/email/format.ts`. The regex
 * fixes the shape and the refinement rejects dates that match it without
 * existing (`2026-02-30`, `2026-13-01`), which would otherwise reach the
 * formatter and render as a real-looking wrong date.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date in YYYY-MM-DD form')
  .refine((value) => {
    const parts = value.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (month < 1 || month > 12 || day < 1) return false;
    // Day 0 of the following month is the last day of this one, in UTC, with
    // no local-zone involvement — the only arithmetic here that touches Date.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= lastDay;
  }, 'must be a real calendar date');

/** One figure and its week-over-week change. `null` means "no comparison". */
const weeklyMetric = z
  .object({
    count,
    /**
     * Nullable rather than optional. The API must state explicitly that a
     * comparison was impossible — a previous week with no activity — so that
     * "no baseline" cannot be confused with "the field was forgotten".
     * Bounded because a percentage in the millions is a bug upstream, and
     * finite because `Infinity` serialises to `null` in JSON only sometimes.
     */
    changePercent: z.number().finite().min(-100).max(100_000).nullable(),
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

export const sendSchema = z.discriminatedUnion('template', [
  z
    .object({
      to: email,
      template: z.literal('scan-report'),
      theme: theme.optional(),
      data: z
        .object({
          userName,
          projectName: displayName('projectName'),
          securityScore: z.number().min(0).max(100).nullable().optional(),
          riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
          counts: severityCounts.optional(),
          totalFindings: count.optional(),
          endpointsEvaluated: count.optional(),
          scanDate: calendarDate.optional(),
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
      theme: theme.optional(),
      data: z
        .object({
          userName,
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
      theme: theme.optional(),
      data: z
        .object({
          userName,
          projectName: displayName('projectName'),
          criticalCount: count,
          issuesUrl: url.optional(),
        })
        .strict(),
      attachment: z.undefined().optional(),
    })
    .strict(),

  z
    .object({
      to: email,
      template: z.literal('weekly-summary'),
      theme: theme.optional(),
      data: z
        .object({
          userName,
          dateFrom: calendarDate,
          dateTo: calendarDate,
          assessments: weeklyMetric,
          findings: weeklyMetric,
          critical: weeklyMetric,
          activeProjects: count,
          dashboardUrl: url.optional(),
        })
        .strict()
        // A range that runs backwards is a bug in the caller's week arithmetic,
        // and it renders as a nonsensical "August 13 – 7". Rejecting it here
        // turns a silently wrong email into a 400 the caller can act on.
        .refine(
          (data) => data.dateFrom <= data.dateTo,
          // ISO dates are lexicographically ordered, so string comparison is
          // date comparison and no parsing is needed.
          { message: '`dateFrom` must not be after `dateTo`', path: ['dateFrom'] },
        ),
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
    message = `\`template\` must be one of: ${TEMPLATE_DISCRIMINATORS.join(', ')}`;
  } else {
    message = issue?.message ?? 'Invalid request body';
  }

  throw badRequest(message, `validation failed at ${path || '<root>'}: ${issue?.code}`);
}

/** Named in the 400 above, so a caller with a typo is told what is accepted. */
const TEMPLATE_DISCRIMINATORS = [
  'scan-report',
  'scan-failed',
  'critical-finding',
  'weekly-summary',
] as const;
