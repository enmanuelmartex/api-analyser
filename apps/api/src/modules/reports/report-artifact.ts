/**
 * Pure artifact rules for reports: how a format maps to bytes on the wire, and
 * how a stored artifact is named.
 *
 * Kept free of Nest and Prisma so the naming and content-type rules — the parts
 * a malicious `reportId` or project name would attack — are unit testable
 * without a database or an HTTP layer.
 */

import { appBrand } from '../../brand/brand';

export type ReportFormat = 'PDF' | 'HTML' | 'MARKDOWN' | 'JSON' | 'SARIF';
export type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';

export const REPORT_FORMATS: readonly ReportFormat[] = [
  'PDF',
  'HTML',
  'MARKDOWN',
  'JSON',
  'SARIF',
] as const;

export const REPORT_TYPES: readonly ReportType[] = [
  'TECHNICAL',
  'EXECUTIVE',
  'DEVELOPER',
  'COMPLIANCE',
] as const;

/** Version stamped onto every artifact this build produces. */
export const GENERATOR_VERSION = '1.0.0';

interface FormatSpec {
  extension: string;
  contentType: string;
  /** True when the delivered bytes are not the stored source snapshot. */
  binary: boolean;
}

const FORMAT_SPEC: Record<ReportFormat, FormatSpec> = {
  PDF: { extension: 'pdf', contentType: 'application/pdf', binary: true },
  HTML: { extension: 'html', contentType: 'text/html; charset=utf-8', binary: false },
  MARKDOWN: { extension: 'md', contentType: 'text/markdown; charset=utf-8', binary: false },
  JSON: { extension: 'json', contentType: 'application/json; charset=utf-8', binary: false },
  SARIF: { extension: 'sarif', contentType: 'application/sarif+json; charset=utf-8', binary: false },
};

export function isReportFormat(value: unknown): value is ReportFormat {
  // Membership test against the list, not `in FORMAT_SPEC`: `in` also matches
  // inherited keys, so `__proto__` and `constructor` passed as valid formats.
  return REPORT_FORMATS.includes(value as ReportFormat);
}

export function isReportType(value: unknown): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

export function formatSpec(format: ReportFormat): FormatSpec {
  return FORMAT_SPEC[format];
}

export function contentTypeFor(format: ReportFormat): string {
  return FORMAT_SPEC[format].contentType;
}

export function extensionFor(format: ReportFormat): string {
  return FORMAT_SPEC[format].extension;
}

/** A binary format cannot be replayed from the source snapshot as-is. */
export function isBinaryFormat(format: ReportFormat): boolean {
  return FORMAT_SPEC[format].binary;
}

/**
 * Reduces free text to a safe file-name fragment.
 *
 * Project names reach the download filename, so everything that could break out
 * of a `Content-Disposition` header or a path — quotes, separators, control
 * characters, dot runs — is collapsed to a single hyphen.
 */
export function slugify(value: string, fallback = 'report'): string {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return slug || fallback;
}

/**
 * The name the browser saves the artifact under.
 *
 * Derived entirely on the server and stored with the report, so the same report
 * downloads under the same name forever — a client-supplied name is never used.
 */
export function buildFileName(input: {
  projectName: string;
  type: ReportType;
  format: ReportFormat;
  generatedAt: Date;
  version?: number;
}): string {
  const date = input.generatedAt.toISOString().split('T')[0];
  const revision = input.version && input.version > 1 ? `-v${input.version}` : '';
  return [
    appBrand.fileSlug,
    slugify(input.projectName, 'report'),
    input.type.toLowerCase(),
    date + revision,
  ].join('-') + '.' + extensionFor(input.format);
}

/**
 * The storage-root-relative name of a binary artifact.
 *
 * Built from the report's own id — never from user input and never containing a
 * directory separator — so joining it with the storage root cannot traverse out
 * of it. `assertStoredFileName` re-checks this on the way back out, because the
 * value has round-tripped through the database in between.
 */
export function buildStoredFileName(reportId: string, format: ReportFormat): string {
  return `${reportId}.${extensionFor(format)}`;
}

/**
 * Rejects any stored path that is not a bare file name.
 *
 * Defence in depth for the download path: the column is only ever written by
 * `buildStoredFileName`, but a tampered or migrated row must not be able to
 * make the server read `../../.env`.
 */
export function assertStoredFileName(filePath: string): string {
  const invalid =
    !filePath ||
    filePath.includes('/') ||
    filePath.includes('\\') ||
    filePath.includes('\0') ||
    filePath === '.' ||
    filePath === '..' ||
    filePath.startsWith('.') ||
    /^[a-zA-Z]:/.test(filePath);

  if (invalid) throw new Error('Refusing to read report artifact from an unexpected path');
  return filePath;
}

/**
 * Escapes a file name for `Content-Disposition`.
 *
 * Emits both the plain `filename=` (quoted, ASCII-folded) and the RFC 5987
 * `filename*=` form, so non-ASCII project names survive without the quoted form
 * ever being able to inject a header token.
 */
export function contentDisposition(fileName: string): string {
  const safe = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
