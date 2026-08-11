"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TOTAL_PENALTY = exports.MAX_EXPOSURE_MULTIPLIER = exports.SEVERITY_WEIGHTS = exports.MIN_SECURITY_SCORE = exports.SCORE_VERSION = void 0;
exports.componentKey = componentKey;
exports.aggregationKey = aggregationKey;
exports.exposureMultiplier = exposureMultiplier;
exports.computeScore = computeScore;
exports.SCORE_VERSION = 'score-v2';
exports.MIN_SECURITY_SCORE = 1;
exports.SEVERITY_WEIGHTS = {
    CRITICAL: 40,
    HIGH: 20,
    MEDIUM: 8,
    LOW: 2,
    INFO: 0,
};
exports.MAX_EXPOSURE_MULTIPLIER = 2.0;
exports.MAX_TOTAL_PENALTY = 100;
const UNSCORABLE_STATUSES = new Set(['PENDING', 'QUEUED', 'RUNNING', 'FAILED', 'CANCELLED']);
function componentKey(issue) {
    return `${issue.method}|${issue.normalizedRoute}|${issue.component}`;
}
function aggregationKey(issue) {
    return `${issue.pluginId}|${issue.ruleId}`;
}
function exposureMultiplier(distinctAffectedComponents) {
    const n = Math.max(1, distinctAffectedComponents);
    return Math.min(exports.MAX_EXPOSURE_MULTIPLIER, 1 + 0.25 * Math.log2(n));
}
function computeScore(input) {
    const { assessmentStatus, issues, coverage } = input;
    const reasons = [];
    const coveragePercent = coverage.plannedChecks > 0
        ? Math.round((coverage.successfulChecks / coverage.plannedChecks) * 1000) / 10
        : null;
    const base = {
        scoreVersion: exports.SCORE_VERSION,
        weights: exports.SEVERITY_WEIGHTS,
        coverage,
        coveragePercent,
    };
    if (UNSCORABLE_STATUSES.has(assessmentStatus)) {
        reasons.push(assessmentStatus === 'FAILED' || assessmentStatus === 'CANCELLED'
            ? `The scan ended as ${assessmentStatus}, so its results do not describe the API's security posture.`
            : `The scan is ${assessmentStatus} and has not produced results yet.`);
        return unavailable(base, reasons, issues.length);
    }
    if (coverage.successfulChecks <= 0) {
        reasons.push('No security check completed successfully, so there is nothing to base a score on.');
        return unavailable(base, reasons, issues.length);
    }
    if (coverage.plannedChecks <= 0) {
        reasons.push('No checks were planned for this scan, so coverage is unknown.');
        return unavailable(base, reasons, issues.length);
    }
    const deduplicated = dedupeByFingerprint(issues);
    const rulePenalties = buildRulePenalties(deduplicated);
    const uncappedPenalty = round2(rulePenalties.reduce((sum, rule) => sum + rule.rulePenalty, 0));
    const totalPenalty = Math.min(exports.MAX_TOTAL_PENALTY, uncappedPenalty);
    const securityScore = Math.round(Math.max(exports.MIN_SECURITY_SCORE, 100 - totalPenalty));
    if (coverage.failedChecks > 0) {
        reasons.push(`${coverage.failedChecks} check(s) failed during this scan, so parts of the API were not evaluated.`);
    }
    if (coverage.skippedChecks > 0) {
        reasons.push(`${coverage.skippedChecks} check(s) were not run, so this score covers only the checks that were selected.`);
    }
    if (coverage.executionErrors > 0 && coverage.failedChecks === 0) {
        reasons.push(`${coverage.executionErrors} execution error(s) occurred during this scan.`);
    }
    const scoreStatus = reasons.length === 0 ? 'FINAL' : 'PROVISIONAL';
    return {
        ...base,
        securityScore,
        scoreStatus,
        totalPenalty,
        uncappedPenalty,
        severityBreakdown: severityBreakdown(deduplicated),
        rulePenalties,
        reasons,
        issuesConsidered: deduplicated.length,
    };
}
function unavailable(base, reasons, issuesConsidered) {
    return {
        ...base,
        securityScore: null,
        scoreStatus: 'UNAVAILABLE',
        totalPenalty: 0,
        uncappedPenalty: 0,
        severityBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
        rulePenalties: [],
        reasons,
        issuesConsidered,
    };
}
function dedupeByFingerprint(issues) {
    const seen = new Map();
    for (const issue of issues) {
        if (!seen.has(issue.fingerprint))
            seen.set(issue.fingerprint, issue);
    }
    return [...seen.values()];
}
function buildRulePenalties(issues) {
    const groups = new Map();
    for (const issue of issues) {
        const key = aggregationKey(issue);
        const group = groups.get(key);
        if (group)
            group.push(issue);
        else
            groups.set(key, [issue]);
    }
    const penalties = [];
    for (const [key, group] of groups) {
        const highestSeverity = group.reduce((worst, issue) => exports.SEVERITY_WEIGHTS[issue.severity] > exports.SEVERITY_WEIGHTS[worst] ? issue.severity : worst, group[0].severity);
        const affectedComponents = [...new Set(group.map(componentKey))].sort();
        const multiplier = exposureMultiplier(affectedComponents.length);
        const severityWeight = exports.SEVERITY_WEIGHTS[highestSeverity];
        penalties.push({
            pluginId: group[0].pluginId,
            ruleId: group[0].ruleId,
            aggregationKey: key,
            highestSeverity,
            severityWeight,
            fingerprints: group.map((issue) => issue.fingerprint).sort(),
            fingerprintCount: group.length,
            affectedComponents,
            distinctAffectedComponents: affectedComponents.length,
            exposureMultiplier: round2(multiplier),
            rulePenalty: round2(severityWeight * multiplier),
            manifestations: group
                .map((issue) => ({
                fingerprint: issue.fingerprint,
                component: componentKey(issue),
                severity: issue.severity,
            }))
                .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
        });
    }
    return penalties.sort((a, b) => b.rulePenalty - a.rulePenalty || a.aggregationKey.localeCompare(b.aggregationKey));
}
function severityBreakdown(issues) {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const issue of issues)
        counts[issue.severity] += 1;
    return counts;
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
//# sourceMappingURL=score-engine.js.map