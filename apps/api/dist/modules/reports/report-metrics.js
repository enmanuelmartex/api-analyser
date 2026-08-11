"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySeverityTotals = emptySeverityTotals;
exports.sumSeverities = sumSeverities;
exports.averageScore = averageScore;
exports.averageScoreDelta = averageScoreDelta;
exports.buildTrend = buildTrend;
exports.trendDelta = trendDelta;
function emptySeverityTotals() {
    return {
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        totalFindings: 0,
    };
}
function sumSeverities(assessments) {
    return assessments.reduce((totals, a) => {
        totals.criticalCount += a.critical;
        totals.highCount += a.high;
        totals.mediumCount += a.medium;
        totals.lowCount += a.low;
        totals.infoCount += a.info;
        totals.totalFindings += a.total;
        return totals;
    }, emptySeverityTotals());
}
function averageScore(assessments) {
    const scored = assessments
        .map((a) => a.securityScore)
        .filter((score) => typeof score === 'number');
    return {
        avgSecurityScore: scored.length > 0
            ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
            : null,
        scoredAssessments: scored.length,
    };
}
function averageScoreDelta(assessments, windowDays, now = new Date()) {
    const end = now.getTime();
    const currentStart = end - windowDays * DAY_MS;
    const previousStart = currentStart - windowDays * DAY_MS;
    const inWindow = (from, to) => assessments.filter((a) => {
        const at = a.completedAt.getTime();
        return at >= from && at < to && typeof a.securityScore === 'number';
    });
    const current = inWindow(currentStart, end);
    const previous = inWindow(previousStart, currentStart);
    if (current.length === 0 || previous.length === 0)
        return null;
    const mean = (list) => Math.round(list.reduce((sum, a) => sum + a.securityScore, 0) / list.length);
    const currentAverage = mean(current);
    const previousAverage = mean(previous);
    const deltaPoints = currentAverage - previousAverage;
    return {
        currentAverage,
        previousAverage,
        deltaPoints,
        deltaPercent: previousAverage === 0
            ? null
            : Math.round((deltaPoints / previousAverage) * 1000) / 10,
        direction: deltaPoints > 0 ? 'up' : deltaPoints < 0 ? 'down' : 'flat',
        currentSampleSize: current.length,
        previousSampleSize: previous.length,
    };
}
const DAY_MS = 24 * 60 * 60 * 1000;
function dayKey(date) {
    return date.toISOString().split('T')[0];
}
function buildTrend(assessments, windowDays, now = new Date()) {
    const points = new Map();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let i = windowDays - 1; i >= 0; i--) {
        const key = dayKey(new Date(end.getTime() - i * DAY_MS));
        points.set(key, { date: key, critical: 0, high: 0, medium: 0, low: 0, total: 0, scans: 0 });
    }
    for (const assessment of assessments) {
        const point = points.get(dayKey(assessment.completedAt));
        if (!point)
            continue;
        point.critical += assessment.critical;
        point.high += assessment.high;
        point.medium += assessment.medium;
        point.low += assessment.low;
        point.total += assessment.total;
        point.scans += 1;
    }
    return [...points.values()];
}
function trendDelta(points) {
    if (points.length < 2)
        return null;
    const midpoint = Math.floor(points.length / 2);
    const previous = points.slice(0, midpoint).reduce((sum, p) => sum + p.total, 0);
    const current = points.slice(midpoint).reduce((sum, p) => sum + p.total, 0);
    if (previous === 0)
        return null;
    const changePercent = Math.round(((current - previous) / previous) * 1000) / 10;
    return {
        current,
        previous,
        changePercent,
        direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
    };
}
//# sourceMappingURL=report-metrics.js.map