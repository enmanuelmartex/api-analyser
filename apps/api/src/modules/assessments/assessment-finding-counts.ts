import type { Severity } from '@prisma/client';

/**
 * Per-assessment finding counts, derived from the real `FindingOccurrence` rows
 * of a scan — NOT from the persisted `AssessmentSummary` counters.
 *
 * The summary counters are a snapshot written by the scanner and can legitimately
 * be missing or stale (e.g. demo/seed data, or an assessment created before the
 * counters were aggregated). The occurrences are the source of truth for "what
 * did this scan detect", so the list and detail screens count them directly.
 *
 * `total` is the number of ALL findings for the assessment, every severity
 * included — not just critical + high.
 */
export interface FindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export function emptyFindingCounts(): FindingCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
}

/**
 * The shape of one row from
 * `findingOccurrence.groupBy({ by: ['assessmentId', 'severitySnapshot'], _count: { _all: true } })`.
 */
export interface OccurrenceSeverityGroup {
  assessmentId: string;
  severitySnapshot: Severity;
  _count: { _all: number };
}

/**
 * Folds grouped `(assessmentId, severity) → count` rows into a
 * `assessmentId → FindingCounts` map.
 *
 * Kept as a pure function, separate from Prisma, so the counting rules
 * (total sums every severity; each severity lands in its own bucket) are unit
 * testable without a database. A single grouped query feeds this, so N
 * assessments never trigger N queries.
 */
export function foldOccurrenceCounts(
  groups: OccurrenceSeverityGroup[],
): Map<string, FindingCounts> {
  const byAssessment = new Map<string, FindingCounts>();

  for (const group of groups) {
    const counts = byAssessment.get(group.assessmentId) ?? emptyFindingCounts();
    const n = group._count._all;
    counts.total += n;
    switch (group.severitySnapshot) {
      case 'CRITICAL':
        counts.critical += n;
        break;
      case 'HIGH':
        counts.high += n;
        break;
      case 'MEDIUM':
        counts.medium += n;
        break;
      case 'LOW':
        counts.low += n;
        break;
      case 'INFO':
        counts.info += n;
        break;
    }
    byAssessment.set(group.assessmentId, counts);
  }

  return byAssessment;
}
