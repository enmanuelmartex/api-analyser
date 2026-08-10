import type { PluginManifest } from '../scanner/types/plugin-manifest.types';

/**
 * What the product actually tests, per OWASP API Security Top 10 (2023).
 *
 * This exists because coverage used to be a hand-written marketing string in
 * the UI ("11 OWASP Plugins — Full API Top 10 2023 coverage"). Both halves were
 * false at the time: ten checks, mapping to seven categories. For a security
 * product, an overstated coverage claim is the most damaging kind of defect — a
 * user reasonably concludes that a category with no check behind it was tested
 * and found clean.
 *
 * Coverage is derived from the plugin manifests, so it cannot drift: adding a
 * check that declares `API6:2023` moves that category to covered on its own,
 * and no check can be removed while leaving a stale claim behind.
 *
 * Every category now has at least one check. That makes a second kind of
 * dishonesty possible, and `scopeNote` exists to prevent it: "covered" means a
 * check runs, never that the category is exhaustively tested. Where a check can
 * only reach part of what its category describes — because the rest is not
 * observable from outside the target — the note says so, and it is rendered
 * beside the covered row rather than buried in documentation.
 *
 * Three distinct states, which must never be rendered the same way:
 *
 *   COVERED                a check ran. Zero findings means it found nothing.
 *   COVERED + scopeNote    a check ran, and part of the category is out of its
 *                          reach. Zero findings means less than it appears to.
 *   NOT COVERED            nothing was ever looked at here.
 */

export type OwaspCoverageStatus = 'COVERED' | 'NOT_COVERED';

export interface OwaspCategoryCoverage {
  /** Canonical id, e.g. `API1:2023`. */
  id: string;
  /** Short form used in compact UI, e.g. `API1`. */
  shortId: string;
  title: string;
  description: string;
  status: OwaspCoverageStatus;
  /** Ids of the security checks that declare this category. */
  checkIds: string[];
  /** Human names of those checks, in the same order. */
  checkNames: string[];
  /** How many declared rules across those checks. */
  ruleCount: number;
  /** Set when nothing covers the category — shown verbatim in the UI. */
  gapReason?: string;
  /**
   * Set when the checks that cover this category can only reach part of it.
   *
   * Shown on a covered row, verbatim. Its job is to stop "covered" from being
   * read as "exhaustively tested" where that would be wrong.
   */
  scopeNote?: string;
}

export interface OwaspCoverageSummary {
  edition: '2023';
  categories: OwaspCategoryCoverage[];
  coveredCount: number;
  totalCount: number;
  /** e.g. "10/10" — always derived from the manifests, never written by hand. */
  label: string;
  checkCount: number;
  ruleCount: number;
}

interface CategoryDefinition {
  id: string;
  shortId: string;
  title: string;
  description: string;
  /** Why no check covers it yet. Only meaningful while uncovered. */
  gapReason: string;
  /** What the covering checks cannot reach. Only meaningful while covered. */
  scopeNote?: string;
}

/**
 * The ten categories of the 2023 edition, in order.
 *
 * `gapReason` is written for every category, not only the uncovered ones, so
 * that a category which later loses its last check still explains itself.
 */
export const OWASP_API_TOP_10_2023: readonly CategoryDefinition[] = [
  {
    id: 'API1:2023',
    shortId: 'API1',
    title: 'Broken Object Level Authorization',
    description:
      'Endpoints that expose object identifiers without verifying the caller may access that specific object.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API2:2023',
    shortId: 'API2',
    title: 'Broken Authentication',
    description:
      'Authentication that can be bypassed, is missing entirely, or accepts credentials it should reject.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API3:2023',
    shortId: 'API3',
    title: 'Broken Object Property Level Authorization',
    description:
      'Excessive data exposure and mass assignment — reading or writing object properties the caller should not reach.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API4:2023',
    shortId: 'API4',
    title: 'Unrestricted Resource Consumption',
    description:
      'Missing rate limiting or quota enforcement, allowing a caller to exhaust compute, bandwidth or third-party spend.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API5:2023',
    shortId: 'API5',
    title: 'Broken Function Level Authorization',
    description:
      'Administrative or privileged operations reachable by callers who should not hold that role.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API6:2023',
    shortId: 'API6',
    title: 'Unrestricted Access to Sensitive Business Flows',
    description:
      'Business flows — purchase, booking, posting — that can be automated at scale to the detriment of the business.',
    gapReason: 'No check declares this category.',
    scopeNote:
      'Flows are identified from the naming in the specification, and each finding names the term that matched so the classification can be judged. A sensitive flow named in terms the vocabulary does not recognise is not examined, and whether a flow is genuinely business-critical remains a judgement only the API owner can make.',
  },
  {
    id: 'API7:2023',
    shortId: 'API7',
    title: 'Server Side Request Forgery',
    description:
      'Endpoints that fetch a caller-supplied URL without validating its destination.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API8:2023',
    shortId: 'API8',
    title: 'Security Misconfiguration',
    description:
      'Missing or permissive security headers, over-broad CORS policies, and other transport and platform misconfiguration.',
    gapReason: 'No check declares this category.',
  },
  {
    id: 'API9:2023',
    shortId: 'API9',
    title: 'Improper Inventory Management',
    description:
      'Undocumented, deprecated or non-production API versions still reachable in the environment under test.',
    gapReason: 'No check declares this category.',
    scopeNote:
      'Probing is confined to the host under assessment: undocumented versions, deprecated operations and exposed documentation, actuator and metrics surfaces on that host. A shadow API on a different hostname cannot be found this way — that needs an asset inventory the scanner is not given, and probing hosts nobody nominated would be scanning something nobody authorised.',
  },
  {
    id: 'API10:2023',
    shortId: 'API10',
    title: 'Unsafe Consumption of APIs',
    description:
      'Trusting data from third-party APIs the service itself calls, without validating it.',
    gapReason: 'No check declares this category.',
    scopeNote:
      'Only what crosses the client boundary is observable: upstream references returned over plain HTTP, upstream errors relayed verbatim, and inbound webhooks that accept unverified senders. The traffic the target sends to its own upstreams is invisible to a black-box scan, so whether it validates what those upstreams return cannot be settled here — that needs code or egress analysis.',
  },
] as const;

/**
 * Computes coverage from the installed check manifests.
 *
 * Pure and synchronous — it reads nothing but the manifests it is handed, so
 * the same registry always produces the same answer and it can be asserted
 * directly in a test.
 */
export function computeOwaspCoverage(manifests: PluginManifest[]): OwaspCoverageSummary {
  const categories = OWASP_API_TOP_10_2023.map((definition): OwaspCategoryCoverage => {
    const matching = manifests.filter((manifest) =>
      manifest.owaspMappings.includes(definition.id),
    );

    const covered = matching.length > 0;

    return {
      id: definition.id,
      shortId: definition.shortId,
      title: definition.title,
      description: definition.description,
      status: covered ? 'COVERED' : 'NOT_COVERED',
      checkIds: matching.map((m) => m.id),
      checkNames: matching.map((m) => m.name),
      ruleCount: matching.reduce((total, m) => total + m.ruleIds.length, 0),
      // Exactly one of the two is ever present: a gap explains an absence, a
      // scope note qualifies a presence.
      ...(covered
        ? definition.scopeNote
          ? { scopeNote: definition.scopeNote }
          : {}
        : { gapReason: definition.gapReason }),
    };
  });

  const coveredCount = categories.filter((c) => c.status === 'COVERED').length;

  return {
    edition: '2023',
    categories,
    coveredCount,
    totalCount: categories.length,
    label: `${coveredCount}/${categories.length}`,
    checkCount: manifests.length,
    ruleCount: manifests.reduce((total, m) => total + m.ruleIds.length, 0),
  };
}
