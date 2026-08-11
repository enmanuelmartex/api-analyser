"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOutcome = classifyOutcome;
exports.wasProcessed = wasProcessed;
exports.wasChallenged = wasChallenged;
const CHALLENGE_STATUSES = [401, 403, 407, 429];
const ABSENT_STATUSES = [404, 405, 410, 501];
function classifyOutcome(status) {
    if (!status || status <= 0)
        return 'error';
    if (CHALLENGE_STATUSES.includes(status))
        return 'challenged';
    if (ABSENT_STATUSES.includes(status))
        return 'absent';
    if (status >= 500)
        return 'error';
    return 'processed';
}
function wasProcessed(status) {
    return classifyOutcome(status) === 'processed';
}
function wasChallenged(status) {
    return classifyOutcome(status) === 'challenged';
}
//# sourceMappingURL=request-outcome.js.map