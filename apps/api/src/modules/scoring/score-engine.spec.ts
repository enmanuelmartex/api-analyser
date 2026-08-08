import {
  computeScore,
  componentKey,
  exposureMultiplier,
  MAX_EXPOSURE_MULTIPLIER,
  SCORE_VERSION,
  SEVERITY_WEIGHTS,
  type ScorableIssue,
  type ScoreInput,
} from './score-engine';

function issue(overrides: Partial<ScorableIssue> = {}): ScorableIssue {
  return {
    fingerprint: `fp-${Math.random()}`,
    pluginId: 'security-headers',
    ruleId: 'headers.missing-hsts',
    severity: 'HIGH',
    method: 'GET',
    normalizedRoute: '/users/{id}',
    component: 'response-header:strict-transport-security',
    ...overrides,
  };
}

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    assessmentStatus: 'COMPLETED',
    issues: [],
    coverage: {
      plannedChecks: 10,
      successfulChecks: 10,
      failedChecks: 0,
      skippedChecks: 0,
      executionErrors: 0,
    },
    ...overrides,
  };
}

describe('score status', () => {
  it.each(['FAILED', 'CANCELLED'])('%s produces a null score', (assessmentStatus) => {
    const result = computeScore(input({ assessmentStatus }));
    expect(result.securityScore).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.reasons.join(' ')).toContain(assessmentStatus);
  });

  it.each(['QUEUED', 'RUNNING', 'PENDING'])('%s produces a null score', (assessmentStatus) => {
    const result = computeScore(input({ assessmentStatus }));
    expect(result.securityScore).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
  });

  it('is UNAVAILABLE when no check succeeded, even if the scan completed', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 5, successfulChecks: 0, failedChecks: 5, skippedChecks: 0, executionErrors: 5 } }),
    );
    expect(result.securityScore).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.reasons[0]).toContain('No security check completed successfully');
  });

  it('is PROVISIONAL when some checks failed', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 10, successfulChecks: 9, failedChecks: 1, skippedChecks: 0, executionErrors: 1 } }),
    );
    expect(result.scoreStatus).toBe('PROVISIONAL');
    expect(result.securityScore).not.toBeNull();
    expect(result.reasons.join(' ')).toContain('failed');
  });

  it('is PROVISIONAL when checks were skipped', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 10, successfulChecks: 4, failedChecks: 0, skippedChecks: 6, executionErrors: 0 } }),
    );
    expect(result.scoreStatus).toBe('PROVISIONAL');
  });

  it('is FINAL only when every planned check succeeded', () => {
    const result = computeScore(input());
    expect(result.scoreStatus).toBe('FINAL');
    expect(result.reasons).toEqual([]);
  });

  it('only a FINAL scan with no penalised issues reaches 100', () => {
    const result = computeScore(input());
    expect(result.securityScore).toBe(100);
    expect(result.scoreStatus).toBe('FINAL');
  });

  it('a scan with informational issues only still reaches 100', () => {
    const result = computeScore(input({ issues: [issue({ severity: 'INFO' })] }));
    expect(result.securityScore).toBe(100);
  });
});

describe('coverage', () => {
  it('is null when nothing was planned — never 100', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 0, successfulChecks: 0, failedChecks: 0, skippedChecks: 0, executionErrors: 0 } }),
    );
    expect(result.coveragePercent).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
  });

  it('counts only successful checks', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 10, successfulChecks: 5, failedChecks: 3, skippedChecks: 2, executionErrors: 3 } }),
    );
    expect(result.coveragePercent).toBe(50);
  });

  it('is reported independently of the score', () => {
    const result = computeScore(
      input({
        issues: [issue({ severity: 'CRITICAL' })],
        coverage: { plannedChecks: 10, successfulChecks: 2, failedChecks: 0, skippedChecks: 8, executionErrors: 0 },
      }),
    );
    // A high score with low coverage must remain visibly low-coverage.
    expect(result.securityScore).toBe(60);
    expect(result.coveragePercent).toBe(20);
    expect(result.scoreStatus).toBe('PROVISIONAL');
  });
});

describe('penalties', () => {
  it('weights CRITICAL more heavily than HIGH', () => {
    const critical = computeScore(input({ issues: [issue({ severity: 'CRITICAL' })] }));
    const high = computeScore(input({ issues: [issue({ severity: 'HIGH' })] }));
    expect(critical.securityScore!).toBeLessThan(high.securityScore!);
    expect(critical.totalPenalty).toBe(SEVERITY_WEIGHTS.CRITICAL);
  });

  it('orders severities strictly', () => {
    const scores = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map(
      (severity) => computeScore(input({ issues: [issue({ severity })] })).securityScore!,
    );
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it('deduplicates by fingerprint — one issue detected twice penalises once', () => {
    const duplicated = issue({ fingerprint: 'same', severity: 'CRITICAL' });
    const result = computeScore(input({ issues: [duplicated, { ...duplicated }] }));
    expect(result.issuesConsidered).toBe(1);
    expect(result.totalPenalty).toBe(40);
  });

  it('uses 1 as the floor for a scorable assessment rather than conflating it with unavailable', () => {
    const issues = Array.from({ length: 20 }, (_, i) =>
      issue({ fingerprint: `fp-${i}`, ruleId: `headers.rule-${i}`, severity: 'CRITICAL' }),
    );
    const result = computeScore(input({ issues }));
    expect(result.securityScore).toBe(1);
    expect(result.securityScore).not.toBeNull();
    expect(result.scoreStatus).toBe('FINAL');
  });

  it('caps total penalty at 100', () => {
    const issues = Array.from({ length: 50 }, (_, i) =>
      issue({ fingerprint: `fp-${i}`, ruleId: `headers.rule-${i}`, severity: 'CRITICAL' }),
    );
    const result = computeScore(input({ issues }));
    expect(result.totalPenalty).toBe(100);
    expect(result.uncappedPenalty).toBeGreaterThan(100);
  });
});

describe('exposure multiplier', () => {
  it('is 1.0 for a single affected component', () => {
    expect(exposureMultiplier(1)).toBe(1);
  });

  it('grows with breadth', () => {
    expect(exposureMultiplier(2)).toBeCloseTo(1.25, 5);
    expect(exposureMultiplier(4)).toBeCloseTo(1.5, 5);
    expect(exposureMultiplier(8)).toBeCloseTo(1.75, 5);
  });

  it('is capped at 2.0', () => {
    expect(exposureMultiplier(16)).toBe(MAX_EXPOSURE_MULTIPLIER);
    expect(exposureMultiplier(1000)).toBe(MAX_EXPOSURE_MULTIPLIER);
  });

  it('treats 0 and negative input as a single component', () => {
    expect(exposureMultiplier(0)).toBe(1);
    expect(exposureMultiplier(-5)).toBe(1);
  });

  it('scales one rule across many endpoints instead of saturating the score', () => {
    // A rule affecting 16 endpoints is worse than one affecting 1, but must not
    // drive the score to 0 the way per-fingerprint penalties would.
    const issues = Array.from({ length: 16 }, (_, i) =>
      issue({ fingerprint: `fp-${i}`, normalizedRoute: `/resource-${i}`, severity: 'CRITICAL' }),
    );
    const result = computeScore(input({ issues }));

    expect(result.rulePenalties).toHaveLength(1);
    expect(result.rulePenalties[0].distinctAffectedComponents).toBe(16);
    expect(result.rulePenalties[0].exposureMultiplier).toBe(2);
    expect(result.totalPenalty).toBe(80);
    expect(result.securityScore).toBe(20);
  });

  it('counts distinct components, not repeated ones', () => {
    const issues = [
      issue({ fingerprint: 'a', normalizedRoute: '/x', component: 'c1' }),
      issue({ fingerprint: 'b', normalizedRoute: '/x', component: 'c1', method: 'GET' }),
    ];
    // Same METHOD + route + component => one affected component.
    const result = computeScore(input({ issues }));
    expect(result.rulePenalties[0].distinctAffectedComponents).toBe(1);
  });

  it('separates different rules into different penalties', () => {
    const result = computeScore(
      input({
        issues: [
          issue({ fingerprint: 'a', ruleId: 'headers.missing-hsts' }),
          issue({ fingerprint: 'b', ruleId: 'headers.missing-cache-control' }),
        ],
      }),
    );
    expect(result.rulePenalties).toHaveLength(2);
  });

  it('scores a rule by its most severe manifestation', () => {
    const result = computeScore(
      input({
        issues: [
          issue({ fingerprint: 'a', normalizedRoute: '/a', severity: 'LOW' }),
          issue({ fingerprint: 'b', normalizedRoute: '/b', severity: 'CRITICAL' }),
        ],
      }),
    );
    expect(result.rulePenalties[0].highestSeverity).toBe('CRITICAL');
  });
});

describe('determinism and explainability', () => {
  it('produces identical output for identical input', () => {
    const issues = [issue({ fingerprint: 'a' }), issue({ fingerprint: 'b', normalizedRoute: '/b' })];
    expect(JSON.stringify(computeScore(input({ issues })))).toBe(
      JSON.stringify(computeScore(input({ issues }))),
    );
  });

  it('does not depend on the order of the input issues', () => {
    const a = issue({ fingerprint: 'a', normalizedRoute: '/a' });
    const b = issue({ fingerprint: 'b', normalizedRoute: '/b', ruleId: 'headers.other' });
    expect(computeScore(input({ issues: [a, b] })).securityScore).toBe(
      computeScore(input({ issues: [b, a] })).securityScore,
    );
  });

  it('records the version, weights and every input to the arithmetic', () => {
    const result = computeScore(input({ issues: [issue({ severity: 'CRITICAL' })] }));
    expect(result.scoreVersion).toBe(SCORE_VERSION);
    expect(result.weights).toEqual(SEVERITY_WEIGHTS);

    const rule = result.rulePenalties[0];
    expect(rule.severityWeight).toBe(40);
    expect(rule.exposureMultiplier).toBe(1);
    expect(rule.rulePenalty).toBe(40);
    expect(rule.fingerprints).toHaveLength(1);
    expect(rule.affectedComponents).toHaveLength(1);
  });

  it('explains why a result is not final', () => {
    const result = computeScore(
      input({ coverage: { plannedChecks: 10, successfulChecks: 8, failedChecks: 2, skippedChecks: 0, executionErrors: 2 } }),
    );
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join(' ')).toMatch(/failed/i);
  });
});

describe('componentKey', () => {
  it('combines method, route and component', () => {
    expect(componentKey(issue({ method: 'POST', normalizedRoute: '/a', component: 'body:x' })))
      .toBe('POST|/a|body:x');
  });
});

describe('snapshot completeness', () => {
  it('records every field needed to explain a rule penalty', () => {
    const result = computeScore(
      input({
        issues: [
          issue({ fingerprint: 'fp-a', normalizedRoute: '/a', severity: 'LOW' }),
          issue({ fingerprint: 'fp-b', normalizedRoute: '/b', severity: 'CRITICAL' }),
        ],
      }),
    );

    const rule = result.rulePenalties[0];
    expect(rule.pluginId).toBe('security-headers');
    expect(rule.ruleId).toBe('headers.missing-hsts');
    expect(rule.aggregationKey).toBe('security-headers|headers.missing-hsts');
    expect(rule.highestSeverity).toBe('CRITICAL');
    expect(rule.severityWeight).toBe(40);
    expect(rule.fingerprints).toEqual(['fp-a', 'fp-b']);
    expect(rule.fingerprintCount).toBe(2);
    expect(rule.distinctAffectedComponents).toBe(2);
    expect(rule.exposureMultiplier).toBe(1.25);
    expect(rule.rulePenalty).toBe(50);
  });

  it('keeps each manifestation severity, so the highest choice is auditable', () => {
    const result = computeScore(
      input({
        issues: [
          issue({ fingerprint: 'fp-a', normalizedRoute: '/a', severity: 'LOW' }),
          issue({ fingerprint: 'fp-b', normalizedRoute: '/b', severity: 'CRITICAL' }),
        ],
      }),
    );

    const severities = result.rulePenalties[0].manifestations.map((m) => m.severity).sort();
    expect(severities).toEqual(['CRITICAL', 'LOW']);
    // The penalty used the highest, but both are preserved.
    expect(result.rulePenalties[0].highestSeverity).toBe('CRITICAL');
  });

  it('stores affectedComponents in the canonical METHOD|route|component form', () => {
    const result = computeScore(
      input({ issues: [issue({ method: 'POST', normalizedRoute: '/x', component: 'body:pw' })] }),
    );
    expect(result.rulePenalties[0].affectedComponents).toEqual(['POST|/x|body:pw']);
  });
});
