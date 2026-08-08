import { BadRequestException } from '@nestjs/common';

/**
 * Guards OpenAPI parsing against `$ref`-driven SSRF and local file disclosure.
 *
 * `SwaggerParser.dereference()` resolves external references by fetching them —
 * over HTTP(S) and from the local filesystem. That happens for UPLOADED specs
 * too, which bypasses `assertSafeRemoteUrl` entirely: a spec containing
 * `{"$ref": "http://169.254.169.254/latest/meta-data/"}` or
 * `{"$ref": "file:///etc/passwd"}` turns spec import into a request forgery and
 * file-read primitive.
 *
 * We reject external references outright rather than trying to sanitise them.
 * Internal refs (`#/components/...`) are unaffected, which covers the vast
 * majority of real specifications. Supporting vetted remote refs later would
 * mean routing each one through `assertSafeRemoteUrl` before resolution.
 */

/** Maximum nodes visited before we assume the document is hostile or cyclic. */
const MAX_NODES = 200_000;

/** Maximum nesting depth we will walk. */
const MAX_DEPTH = 100;

export function isExternalRef(ref: unknown): boolean {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (trimmed === '') return false;
  // Purely internal JSON pointers are safe.
  return !trimmed.startsWith('#');
}

/** swagger-parser v10 rejects OpenAPI 3.1 before it can dereference it. */
export function isOpenApi31Document(spec: unknown): boolean {
  if (spec === null || typeof spec !== 'object') return false;
  const version = (spec as Record<string, unknown>).openapi;
  return typeof version === 'string' && /^3\.1(?:\.|$)/.test(version.trim());
}

/**
 * Walks the raw specification and throws when any external `$ref` is present.
 * Must run BEFORE `SwaggerParser.dereference`, since dereferencing is what
 * performs the fetch.
 */
export function assertNoExternalRefs(spec: unknown): void {
  const offenders: string[] = [];
  let nodes = 0;

  const visit = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object') return;
    if (depth > MAX_DEPTH) return;
    if (++nodes > MAX_NODES) {
      throw new BadRequestException(
        'The specification is too large or deeply nested to validate safely.',
      );
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && isExternalRef(value)) {
        if (offenders.length < 5) offenders.push(String(value).slice(0, 120));
      }
      visit(value, depth + 1);
    }
  };

  visit(spec, 0);

  if (offenders.length > 0) {
    throw new BadRequestException(
      'This specification contains external $ref references, which are not ' +
        'supported because resolving them would let the specification make ' +
        'network or filesystem requests on the server. Bundle the specification ' +
        'into a single self-contained document and try again. ' +
        `Found: ${offenders.join(', ')}`,
    );
  }
}

/**
 * Options forcing swagger-parser to never resolve anything off-document.
 * Defence in depth: `assertNoExternalRefs` should already have rejected these,
 * but this guarantees no fetch happens even if a ref form slips past the walk.
 */
export const SAFE_PARSER_OPTIONS = {
  resolve: {
    external: false,
    http: false,
    file: false,
  },
  dereference: {
    circular: 'ignore' as const,
  },
};
