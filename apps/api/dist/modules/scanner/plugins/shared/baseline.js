"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDistinctFromBaseline = isDistinctFromBaseline;
function isDistinctFromBaseline(probe, baseline) {
    if (probe.status !== baseline.status)
        return true;
    const delta = Math.abs(probe.bodyLength - baseline.bodyLength);
    const threshold = Math.max(64, baseline.bodyLength * 0.25);
    return delta > threshold;
}
//# sourceMappingURL=baseline.js.map