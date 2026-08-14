/**
 * Parsing and normalising the `email-list` setting kind.
 *
 * Separate from the settings service because it is the one kind with real
 * rules, and because those rules are worth testing on their own: a mistake here
 * means either a security report going to an address nobody checked, or a valid
 * address being silently dropped from a form the operator believes they saved.
 */

/**
 * Deliberately not RFC 5322.
 *
 * A full-grammar regex accepts quoted local parts and comments that no mail
 * provider will take, and rejecting a legal-but-exotic address is a far smaller
 * problem here than accepting something that then fails at send time. This is
 * the pragmatic shape: one `@`, a local part, a dotted domain, no whitespace,
 * no line breaks.
 */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>".]{2,}$/;

/** Long enough for any real address; short enough not to be a payload. */
const MAX_ADDRESS_CHARS = 254;

export class InvalidRecipientError extends Error {
  constructor(readonly address: string) {
    super(`"${address}" is not a valid email address`);
    this.name = 'InvalidRecipientError';
  }
}

/**
 * Accepts what an operator or an environment variable might plausibly write,
 * and returns a clean list.
 *
 * Handles a JSON array (from the API and the database) and a delimited string
 * (from `REPORT_EMAIL_RECIPIENTS`, where a JSON array in a `.env` file is
 * hostile to type). Commas, semicolons and newlines all separate, because all
 * three are what people actually paste.
 *
 * Addresses are lower-cased and de-duplicated. The lower-casing is what makes
 * de-duplication work at all — `Security@Corp.com` and `security@corp.com` are
 * one mailbox everywhere that matters, and sending the same report to both is a
 * bug the operator would have to notice to report.
 *
 * @throws {InvalidRecipientError} on the first address that is not one. Never
 * silently drops: a dropped address is a report nobody receives and nobody
 * knows is missing.
 */
export function parseEmailList(raw: unknown): string[] {
  const candidates = toCandidates(raw);
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const address = candidate.trim();
    if (address.length === 0) continue;

    if (address.length > MAX_ADDRESS_CHARS || !ADDRESS.test(address)) {
      throw new InvalidRecipientError(address.slice(0, 80));
    }

    seen.add(address.toLowerCase());
  }

  return [...seen];
}

/** Whether a value can be parsed, without the exception. */
export function isValidEmailList(raw: unknown): boolean {
  try {
    parseEmailList(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges lists, case-insensitively, preserving the order of first appearance.
 *
 * Used to combine the configured recipients with a user's own address so that
 * an operator who is also on the team mailbox does not get the same report
 * twice.
 */
export function mergeRecipients(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const address of list) {
      const normalised = address.trim().toLowerCase();
      if (normalised.length === 0 || seen.has(normalised)) continue;
      seen.add(normalised);
      merged.push(address.trim());
    }
  }

  return merged;
}

function toCandidates(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')));
  }

  if (typeof raw === 'string') {
    return raw.split(/[,;\n\r]+/);
  }

  if (raw === undefined || raw === null) return [];

  // A number, an object, a boolean: not a recipient list in any reading.
  throw new InvalidRecipientError(String(raw).slice(0, 80));
}
