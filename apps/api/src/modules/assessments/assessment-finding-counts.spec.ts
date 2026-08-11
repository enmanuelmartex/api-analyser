import { describe, expect, it } from 'bun:test';
import {
  countOccurrenceSeverities,
  emptyFindingCounts,
  findingSummaryFields,
  foldOccurrenceCounts,
  riskLevelFor,
  type OccurrenceSeverityGroup,
} from './assessment-finding-counts';

const group = (
  assessmentId: string,
  severitySnapshot: OccurrenceSeverityGroup['severitySnapshot'],
  n: number,
): OccurrenceSeverityGroup => ({ assessmentId, severitySnapshot, _count: { _all: n } });

describe('foldOccurrenceCounts', () => {
  it('returns an empty map when there are no groups', () => {
    expect(foldOccurrenceCounts([]).size).toBe(0);
  });

  it('buckets each severity and sums total across ALL severities', () => {
    const map = foldOccurrenceCounts([
      group('a', 'CRITICAL', 2),
      group('a', 'HIGH', 3),
      group('a', 'MEDIUM', 1),
      group('a', 'LOW', 4),
      group('a', 'INFO', 5),
    ]);
    expect(map.get('a')).toEqual({ critical: 2, high: 3, medium: 1, low: 4, info: 5, total: 15 });
  });

  it('keeps counts isolated per assessment', () => {
    const map = foldOccurrenceCounts([group('a', 'CRITICAL', 1), group('b', 'HIGH', 2)]);
    expect(map.get('a')).toEqual({ critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1 });
    expect(map.get('b')).toEqual({ critical: 0, high: 2, medium: 0, low: 0, info: 0, total: 2 });
  });

  it('emptyFindingCounts is all zeros', () => {
    expect(emptyFindingCounts()).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: 0,
    });
  });

  it('counts an occurrence list with the same rules used by grouped list queries', () => {
    const counts = countOccurrenceSeverities([
      { severitySnapshot: 'CRITICAL' },
      { severitySnapshot: 'HIGH' },
      { severitySnapshot: 'HIGH' },
      { severitySnapshot: 'INFO' },
    ]);

    expect(counts).toEqual({ critical: 1, high: 2, medium: 0, low: 0, info: 1, total: 4 });
    expect(findingSummaryFields(counts)).toEqual({
      totalFindings: 4,
      criticalCount: 1,
      highCount: 2,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 1,
      riskLevel: 'CRITICAL',
    });
  });

  it('derives risk from persisted counts', () => {
    expect(riskLevelFor({ critical: 0, high: 0, medium: 0, low: 0, info: 3, total: 3 })).toBe('LOW');
    expect(riskLevelFor({ critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 })).toBe('MEDIUM');
    expect(riskLevelFor({ critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 })).toBe('HIGH');
  });
});
