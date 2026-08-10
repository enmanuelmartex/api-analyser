/**
 * Splitting API names into comparable tokens.
 *
 * Two checks decide what an endpoint *is* from how it is named — whether it is
 * a sensitive business flow, whether it is a webhook intake. Both must match on
 * whole tokens rather than substrings, because the substring version is
 * confidently wrong: `/reports/generate` contains "rate", `/bookmarks` contains
 * "book", and `/coordinates` contains "ordinate". A check that classifies those
 * as a rating, a booking and an order produces findings a user cannot trust.
 */

/** Crude but predictable singulariser — enough for API path segments. */
export function singularise(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && (token.endsWith('ses') || token.endsWith('xes'))) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Splits a path or free text into singular lowercase tokens.
 *
 * Path parameters are dropped: `{orderId}` names the identifier, not the
 * operation, so `POST /widgets/{orderId}/attach` is not a purchase.
 */
export function tokenise(text: string): string[] {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularise);
}
