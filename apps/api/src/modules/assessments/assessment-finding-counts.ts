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

/** The only occurrence field needed to derive a scan's finding summary. */
export interface OccurrenceSeverity {
  severitySnapshot: Severity;
}

/** Counts the immutable detections that a scan actually persisted. */
export function countOccurrenceSeverities(
  occurrences: readonly OccurrenceSeverity[],
): FindingCounts {
  const counts = emptyFindingCounts();

  for (const occurrence of occurrences) {
    addSeverity(counts, occurrence.severitySnapshot, 1);
  }

  return counts;
}

/** Summary fields whose values must always agree with the occurrence list. */
export function findingSummaryFields(counts: FindingCounts) {
  return {
    totalFindings: counts.total,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    infoCount: counts.info,
    riskLevel: riskLevelFor(counts),
  };
}

/**
 * Overall risk band for a scan, from its finding counts.
 *
 * Lives here, beside the counts, because it must be fed the same numbers the
 * rest of the product shows. It used to be computed inside the scanner from the
 * raw in-memory findings, which is how a scan could be banded on 14 findings
 * while every screen listed 13.
 *
 * The thresholds are unchanged. The original had a redundant `high > 2` branch
 * ahead of `high > 0`, which could never be reached on its own.
 */
export function riskLevelFor(counts: FindingCounts): string {
  if (counts.critical > 0) return 'CRITICAL';
  if (counts.high > 0 || counts.medium > 3) return 'HIGH';
  if (counts.medium > 0 || counts.low > 5) return 'MEDIUM';
  return 'LOW';
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
    addSeverity(counts, group.severitySnapshot, group._count._all);
    byAssessment.set(group.assessmentId, counts);
  }

  return byAssessment;
}

function addSeverity(counts: FindingCounts, severity: Severity, amount: number): void {
  counts.total += amount;
  switch (severity) {
    case 'CRITICAL':
      counts.critical += amount;
      break;
    case 'HIGH':
      counts.high += amount;
      break;
    case 'MEDIUM':
      counts.medium += amount;
      break;
    case 'LOW':
      counts.low += amount;
      break;
    case 'INFO':
      counts.info += amount;
      break;
  }
}
