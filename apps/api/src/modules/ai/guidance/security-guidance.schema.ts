/**
 * The typed contract for AI security guidance.
 *
 * The previous enrichment asked the model for a loose JSON object and spread
 * whatever came back onto the finding (`{ ...f.aiAnalysis, ...arr[i] }`). Three
 * consequences, all of which this module exists to stop:
 *
 *   1. Unvalidated model output reached the report renderer and the UI. A model
 *      that returned a string where an array was expected produced a broken
 *      page rather than a missing section.
 *   2. There was no way to tell a complete answer from a partial one, so a
 *      response missing remediation looked identical to one that had none.
 *   3. Nothing recorded which prompt or knowledge produced a given answer, so
 *      guidance could not be reproduced or audited.
 *
 * `parseSecurityGuidance` never throws and never returns a partially-typed
 * object: it either yields a fully-shaped `SecurityGuidance` with unusable
 * fields dropped, or it reports why it could not. Scanner evidence is always
 * unaffected — AI is advisory and must never be able to break a scan result.
 */

export const GUIDANCE_SCHEMA_VERSION = 'guidance-v1';

export type GuidancePriority = 'IMMEDIATE' | 'SHORT_TERM' | 'PLANNED';

/** How the technology a piece of advice targets came to be known. */
export type ContextConfidence = 'DETECTED' | 'USER_CONFIGURED' | 'INFERRED' | 'UNKNOWN';

export interface RemediationStep {
  title: string;
  description: string;
}

export interface EnvironmentGuidance {
  technology: string;
  /** Why we believe this technology applies. Never fabricated by the model. */
  basis: ContextConfidence;
  guidance: string;
  example?: string;
}

export interface GuidanceReference {
  title: string;
  source: string;
  url?: string;
}

export interface SecurityGuidance {
  schemaVersion: string;
  summary: string;
  rootCause: string;
  businessImpact: string;
  technicalImpact: string;
  remediation: {
    priority: GuidancePriority;
    steps: RemediationStep[];
  };
  environmentGuidance: EnvironmentGuidance[];
  verification: {
    steps: string[];
    expectedResult: string;
  };
  falsePositiveConsiderations: string[];
  references: GuidanceReference[];
  /** 0–1. Clamped; a model that omits it yields `null`, never a default of 1. */
  confidence: number | null;
}

export type GuidanceParseResult =
  | { ok: true; guidance: SecurityGuidance; droppedFields: string[] }
  | { ok: false; errorCode: GuidanceParseError; message: string };

export type GuidanceParseError =
  | 'EMPTY_RESPONSE'
  | 'NOT_JSON'
  | 'NOT_AN_OBJECT'
  | 'MISSING_REQUIRED_FIELDS';

/**
 * The fields without which guidance is not worth showing.
 *
 * A response with a summary but no remediation is worse than none: it tells the
 * user a problem is real and leaves them with nothing to do about it.
 */
const REQUIRED = ['summary', 'rootCause'] as const;

const MAX_TEXT = 4000;
const MAX_ITEMS = 20;

export function parseSecurityGuidance(
  raw: string | null | undefined,
  options: { allowedTechnologies?: Map<string, ContextConfidence> } = {},
): GuidanceParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, errorCode: 'EMPTY_RESPONSE', message: 'The provider returned nothing.' };
  }

  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return {
      ok: false,
      errorCode: 'NOT_JSON',
      message: 'The provider response could not be read as JSON.',
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      errorCode: 'NOT_AN_OBJECT',
      message: 'The provider returned JSON that is not a guidance object.',
    };
  }

  const source = parsed as Record<string, unknown>;
  const missing = REQUIRED.filter((key) => !isNonEmptyString(source[key]));
  if (missing.length > 0) {
    return {
      ok: false,
      errorCode: 'MISSING_REQUIRED_FIELDS',
      message: `The provider response is missing: ${missing.join(', ')}.`,
    };
  }

  const dropped: string[] = [];

  const guidance: SecurityGuidance = {
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    summary: text(source.summary)!,
    rootCause: text(source.rootCause)!,
    businessImpact: text(source.businessImpact) ?? '',
    technicalImpact: text(source.technicalImpact) ?? '',
    remediation: {
      priority: priority(readPath(source, 'remediation.priority')),
      steps: remediationSteps(readPath(source, 'remediation.steps'), dropped),
    },
    environmentGuidance: environmentGuidance(
      source.environmentGuidance,
      options.allowedTechnologies,
      dropped,
    ),
    verification: {
      steps: stringArray(readPath(source, 'verification.steps')),
      expectedResult: text(readPath(source, 'verification.expectedResult')) ?? '',
    },
    falsePositiveConsiderations: stringArray(source.falsePositiveConsiderations),
    references: references(source.references, dropped),
    confidence: confidence(source.confidence),
  };

  return { ok: true, guidance, droppedFields: dropped };
}

// ── Field coercion ───────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim().slice(0, MAX_TEXT) : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString).map((v) => v.trim().slice(0, MAX_TEXT)).slice(0, MAX_ITEMS);
}

function priority(value: unknown): GuidancePriority {
  const normalised = String(value ?? '').toUpperCase().replace(/[\s-]/g, '_');
  if (normalised === 'IMMEDIATE' || normalised === 'CRITICAL' || normalised === 'URGENT') {
    return 'IMMEDIATE';
  }
  if (normalised === 'SHORT_TERM' || normalised === 'HIGH' || normalised === 'SOON') {
    return 'SHORT_TERM';
  }
  // Unknown or absent falls to the least alarming value: an AI-invented urgency
  // must not outrank the scanner's own severity.
  return 'PLANNED';
}

function remediationSteps(value: unknown, dropped: string[]): RemediationStep[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) dropped.push('remediation.steps');
    return [];
  }

  const steps: RemediationStep[] = [];
  for (const entry of value.slice(0, MAX_ITEMS)) {
    if (typeof entry === 'string') {
      // Some models emit a flat list of strings. Usable — promote it.
      if (isNonEmptyString(entry)) steps.push({ title: entry.trim().slice(0, 200), description: '' });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const title = text(record.title) ?? text(record.step);
      if (!title) continue;
      steps.push({ title: title.slice(0, 200), description: text(record.description) ?? '' });
    }
  }
  return steps;
}

/**
 * Environment-specific advice, filtered against what we actually know.
 *
 * A model told an API is "unknown stack" will still happily produce "In NestJS,
 * do X". When `allowedTechnologies` is supplied, any technology not in it is
 * dropped rather than shown — advice for the wrong framework is worse than no
 * framework-specific advice, because a developer may act on it.
 */
function environmentGuidance(
  value: unknown,
  allowed: Map<string, ContextConfidence> | undefined,
  dropped: string[],
): EnvironmentGuidance[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) dropped.push('environmentGuidance');
    return [];
  }

  const result: EnvironmentGuidance[] = [];
  for (const entry of value.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const technology = text(record.technology);
    const guidanceText = text(record.guidance);
    if (!technology || !guidanceText) continue;

    if (allowed && allowed.size > 0) {
      const basis = allowed.get(technology.toLowerCase());
      if (!basis) {
        dropped.push(`environmentGuidance:${technology}`);
        continue;
      }
      result.push({
        technology,
        basis,
        guidance: guidanceText,
        ...(text(record.example) ? { example: text(record.example)! } : {}),
      });
      continue;
    }

    result.push({
      technology,
      basis: 'UNKNOWN',
      guidance: guidanceText,
      ...(text(record.example) ? { example: text(record.example)! } : {}),
    });
  }
  return result;
}

function references(value: unknown, dropped: string[]): GuidanceReference[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) dropped.push('references');
    return [];
  }

  const result: GuidanceReference[] = [];
  for (const entry of value.slice(0, MAX_ITEMS)) {
    if (typeof entry === 'string' && isNonEmptyString(entry)) {
      result.push({ title: entry.trim().slice(0, 200), source: 'unspecified' });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const title = text(record.title);
    if (!title) continue;

    const url = text(record.url);
    result.push({
      title: title.slice(0, 200),
      source: text(record.source) ?? 'unspecified',
      // Only http(s). A model-supplied `javascript:` or `data:` URL would be
      // rendered as a link in the UI and the HTML report.
      ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
    });
  }
  return result;
}

function confidence(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace('%', ''))
        : NaN;

  if (!Number.isFinite(numeric)) {
    // Models often answer HIGH/MEDIUM/LOW instead of a number.
    const label = String(value ?? '').toUpperCase();
    if (label === 'HIGH') return 0.9;
    if (label === 'MEDIUM') return 0.6;
    if (label === 'LOW') return 0.3;
    return null;
  }

  // Accept both 0–1 and 0–100.
  const scaled = numeric > 1 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, Number(scaled.toFixed(2))));
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? acc : acc[key]), source);
}

/**
 * Reads JSON out of a model response.
 *
 * Returns `undefined` when nothing parseable was found, which the caller
 * distinguishes from a legitimate `null`.
 */
function extractJson(raw: string): unknown {
  const attempts = [
    raw,
    raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)?.[1],
    raw.match(/\{[\s\S]*\}/)?.[0],
  ];

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next extraction strategy.
    }
  }
  return undefined;
}
