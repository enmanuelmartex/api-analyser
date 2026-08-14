import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Extracts the token from `Authorization: Bearer <token>`.
 *
 * Returns `null` for every failure mode — absent, wrong scheme, empty token —
 * because the caller treats them identically and a shared return type keeps it
 * from accidentally branching on one.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so the comparison operates on two 32-byte buffers
 * regardless of input length. Comparing the raw strings would need equal
 * lengths for `timingSafeEqual` to run at all, and length-checking first leaks
 * the secret's length through timing.
 */
export function secureCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}
