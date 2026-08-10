/**
 * The reasoning behind the inventory check, kept pure so it can be tested
 * without a target.
 *
 * Everything here works alongside the baseline comparison in
 * `../shared/baseline.ts`, which answers the prior question: *does this route
 * exist, or is the server answering everything the same way?* A scanner that
 * skips that question reports "undocumented API version found" against any host
 * with a catch-all route, and its user learns to ignore the check.
 */

/**
 * Statuses that mean "a route is here" once the baseline says it is distinct.
 *
 * 401 and 403 count: an endpoint that refuses us still exists, and an
 * undocumented version behind auth is exactly the shadow API the category is
 * about. 5xx counts as existing too — nothing crashes on a route that is not
 * routed — but is reported at lower severity because the evidence is weaker.
 */
export function indicatesLiveRoute(status: number): boolean {
  if (status <= 0) return false;
  if ([404, 410, 501].includes(status)) return false;
  return status < 600;
}

/** The version segment of a path, e.g. `/v2/orders` → `v2`. */
export function versionSegmentOf(path: string): string | null {
  for (const segment of path.split('/')) {
    if (/^v\d{1,2}$/i.test(segment)) return segment.toLowerCase();
  }
  return null;
}

/**
 * Neighbouring versions worth probing for a documented one.
 *
 * Ordered by what a real deployment is most likely to have left running: the
 * next version up (already deployed, not yet documented here), then the
 * previous one (never decommissioned), then one further ahead.
 */
export function siblingVersions(
  version: string,
  documented: ReadonlySet<string>,
  limit = 3,
): string[] {
  const major = Number(version.replace(/^v/i, ''));
  if (!Number.isFinite(major)) return [];

  return [major + 1, major - 1, major + 2]
    .filter((candidate) => candidate >= 0)
    .map((candidate) => `v${candidate}`)
    .filter((candidate) => candidate !== version.toLowerCase() && !documented.has(candidate))
    .slice(0, limit);
}

/** Replaces the version segment of a path, leaving everything else intact. */
export function swapVersion(path: string, from: string, to: string): string {
  return path
    .split('/')
    .map((segment) => (segment.toLowerCase() === from.toLowerCase() ? to : segment))
    .join('/');
}

/**
 * Hostname labels that identify an environment as something other than
 * production. Matched as whole labels, so `production-api` is not "prod-uction"
 * and `latest` is not "test".
 */
const NON_PRODUCTION_MARKERS = [
  'dev', 'develop', 'development', 'staging', 'stage', 'test', 'testing',
  'uat', 'qa', 'sandbox', 'sbx', 'preprod', 'preproduction', 'demo', 'internal',
];

/** The marker that identifies a host as non-production, or `null`. */
export function nonProductionMarker(hostname: string): string | null {
  const labels = hostname.toLowerCase().split(/[.\-_]/);
  return NON_PRODUCTION_MARKERS.find((marker) => labels.includes(marker)) ?? null;
}

/**
 * Fingerprints for surfaces that should never be reachable from the internet.
 *
 * A status code alone is not enough — plenty of APIs answer `200` with an HTML
 * shell for any path — so each probe must also recognise its own content before
 * anything is reported.
 */
export interface SurfaceProbe {
  path: string;
  label: string;
  /** Recognises the surface in the response body. */
  matches: (body: string) => boolean;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  /** What the exposure gives away, used in the finding. */
  discloses: string;
}

export const DOCUMENTATION_PROBES: readonly SurfaceProbe[] = [
  {
    path: '/openapi.json',
    label: 'OpenAPI document',
    matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
    severity: 'MEDIUM',
    discloses: 'the full route, parameter and schema inventory of the API',
  },
  {
    path: '/swagger.json',
    label: 'Swagger document',
    matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
    severity: 'MEDIUM',
    discloses: 'the full route, parameter and schema inventory of the API',
  },
  {
    path: '/v3/api-docs',
    label: 'Springdoc API document',
    matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
    severity: 'MEDIUM',
    discloses: 'the full route, parameter and schema inventory of the API',
  },
  {
    path: '/api-docs',
    label: 'API documentation endpoint',
    matches: (body) => /"openapi"\s*:|"swagger"\s*:|swagger-ui/i.test(body),
    severity: 'MEDIUM',
    discloses: 'the full route, parameter and schema inventory of the API',
  },
  {
    path: '/swagger-ui.html',
    label: 'Swagger UI',
    matches: (body) => /swagger-ui/i.test(body),
    severity: 'MEDIUM',
    discloses: 'an interactive console against the live API',
  },
];

export const MANAGEMENT_PROBES: readonly SurfaceProbe[] = [
  {
    path: '/actuator',
    label: 'Spring Boot Actuator index',
    matches: (body) => /"_links"|"actuator"/i.test(body),
    severity: 'MEDIUM',
    discloses: 'the list of management endpoints exposed by the runtime',
  },
  {
    path: '/actuator/env',
    label: 'Spring Boot Actuator environment',
    matches: (body) => /"activeProfiles"|"propertySources"/i.test(body),
    severity: 'HIGH',
    discloses: 'environment variables and configuration properties, frequently including credentials',
  },
  {
    path: '/actuator/mappings',
    label: 'Spring Boot Actuator mappings',
    matches: (body) => /"dispatcherServlets"|"handlerMethod"/i.test(body),
    severity: 'HIGH',
    discloses: 'every route the application serves, documented or not',
  },
  {
    path: '/metrics',
    label: 'Prometheus metrics',
    matches: (body) => /^#\s*(HELP|TYPE)\s/m.test(body),
    severity: 'MEDIUM',
    discloses: 'internal route names, traffic volumes and runtime internals',
  },
  {
    path: '/debug/vars',
    label: 'Go expvar debug endpoint',
    matches: (body) => /"cmdline"|"memstats"/.test(body),
    severity: 'MEDIUM',
    discloses: 'the process command line and memory statistics',
  },
];
