/** A link that is longer than this is not a link. */
export const MAX_URL_CHARS = 2048;

/**
 * A URL the relay is willing to put in an email, or nothing.
 *
 * Links are the one part of these messages a caller influences, and a link is
 * the whole payload of a phishing mail. Three rules:
 *
 *   - **http/https only.** `javascript:` and `data:` are inert in every serious
 *     mail client, but they have no business being emitted, and a relay that
 *     emits them is one client bug away from being the delivery mechanism.
 *     Note that neither `URL` nor Zod's `.url()` rejects them — both accept any
 *     well-formed scheme — so this check is the one that does the work.
 *   - **Parsed, not pattern-matched.** `new URL` rejects the malformed and
 *     normalises the rest, so what is rendered is what was meant.
 *   - **Bounded.**
 *
 * Applied twice on purpose: the schema calls it so a caller with a bad link
 * gets a 400 instead of silently losing it, and the renderer calls it again so
 * nothing but http/https can reach a recipient however the schema later
 * changes.
 *
 * The caller's own host cannot be checked beyond this — a self-hosted install
 * lives at `http://localhost:3000` or at a domain the relay has never heard of
 * — which is why the renderer always prints the destination in visible text
 * rather than hiding it behind a label.
 */
export function safeUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.length > MAX_URL_CHARS) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed.toString();
}

export function isSafeUrl(raw: string): boolean {
  return safeUrl(raw) !== undefined;
}
