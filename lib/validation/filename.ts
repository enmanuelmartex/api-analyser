import { badRequest } from '@/lib/http/errors';
import { MAX_FILENAME_CHARS } from '@/lib/limits';

/** Used when sanitising leaves nothing usable behind. */
export const FALLBACK_FILENAME = 'security-report.pdf';

const PDF_EXTENSION = /\.pdf$/i;

/**
 * The one rule the output obeys: everything outside this set becomes a hyphen.
 *
 * An allow-list rather than a list of dangerous characters, because the set of
 * things that are dangerous in "some mail client, some day, on some filesystem"
 * is not enumerable, while the set a report filename actually needs is. It is
 * also what neutralises the two attacks worth naming — control characters, and
 * the bidirectional overrides that let `report<RLO>fdp.exe` render as
 * `report.pdf` — without this file needing to know about either.
 */
const DISALLOWED = /[^A-Za-z0-9._-]/g;

/**
 * Produces a filename safe to hand to a mail provider and, eventually, to
 * whatever the recipient's client does when they click "save".
 *
 * The name arrives from a self-hosted install, which means it arrives from
 * whatever that install let a user type. Two distinct jobs happen here:
 *
 *   1. **Reject** what is not a PDF at all. A relay that will attach
 *      `payload.html` under a caller-chosen name is a phishing tool.
 *   2. **Sanitise** what is. Path separators, traversal and odd characters are
 *      rewritten rather than rejected, because they are far more often a
 *      careless project name than an attack, and failing a report send over a
 *      slash in a scan name is unhelpful.
 *
 * @throws {RelayError} 400 when the name is not a `.pdf`.
 */
export function sanitiseFilename(raw: string): string {
  const trimmed = raw.trim();

  if (!PDF_EXTENSION.test(trimmed)) {
    throw badRequest('`filename` must end in .pdf');
  }

  // Take the last path segment first, so `../../etc/report.pdf` becomes
  // `report.pdf` rather than a mangled `------etc-report.pdf`.
  const segments = trimmed.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? '';

  const stem = base
    .replace(PDF_EXTENSION, '')
    .replace(DISALLOWED, '-')
    // Collapse the runs the replacement above creates, then strip leading dots
    // and hyphens — a leading dot is a hidden file, a leading hyphen is an
    // argument to anything that later shells out.
    //
    // Collapsing dots also means no `..` can survive in the output. That is
    // belt and braces given the path segments are already gone, but it makes
    // the invariant checkable in one place rather than argued about.
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');

  if (stem.length === 0) return FALLBACK_FILENAME;

  const maxStem = MAX_FILENAME_CHARS - '.pdf'.length;
  return `${stem.slice(0, maxStem)}.pdf`;
}
