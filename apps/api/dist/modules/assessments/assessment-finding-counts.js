"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyFindingCounts = emptyFindingCounts;
exports.countOccurrenceSeverities = countOccurrenceSeverities;
exports.findingSummaryFields = findingSummaryFields;
exports.riskLevelFor = riskLevelFor;
exports.foldOccurrenceCounts = foldOccurrenceCounts;
function emptyFindingCounts() {
    return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
}
function countOccurrenceSeverities(occurrences) {
    const counts = emptyFindingCounts();
    for (const occurrence of occurrences) {
        addSeverity(counts, occurrence.severitySnapshot, 1);
    }
    return counts;
}
function findingSummaryFields(counts) {
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
function riskLevelFor(counts) {
    if (counts.critical > 0)
        return 'CRITICAL';
    if (counts.high > 0 || counts.medium > 3)
        return 'HIGH';
    if (counts.medium > 0 || counts.low > 5)
        return 'MEDIUM';
    return 'LOW';
}
function foldOccurrenceCounts(groups) {
    const byAssessment = new Map();
    for (const group of groups) {
        const counts = byAssessment.get(group.assessmentId) ?? emptyFindingCounts();
        addSeverity(counts, group.severitySnapshot, group._count._all);
        byAssessment.set(group.assessmentId, counts);
    }
    return byAssessment;
}
function addSeverity(counts, severity, amount) {
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
//# sourceMappingURL=assessment-finding-counts.js.map