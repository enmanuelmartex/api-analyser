"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRuleDeclarationProblems = findRuleDeclarationProblems;
exports.collectDeclaredRuleIds = collectDeclaredRuleIds;
function findRuleDeclarationProblems(manifests) {
    const problems = [];
    const owners = new Map();
    for (const manifest of manifests) {
        const { id, ruleNamespace, ruleIds } = manifest;
        if (!ruleNamespace?.trim()) {
            problems.push(`Plugin "${id}" declares no ruleNamespace.`);
            continue;
        }
        if (!ruleIds?.length) {
            problems.push(`Plugin "${id}" declares no ruleIds. A plugin that can emit a finding must ` +
                `declare every rule it produces, otherwise a finding could be persisted ` +
                `without a stable identity.`);
            continue;
        }
        const seenInPlugin = new Set();
        for (const ruleId of ruleIds) {
            if (!ruleId?.trim()) {
                problems.push(`Plugin "${id}" declares an empty ruleId.`);
                continue;
            }
            if (!ruleId.includes('.')) {
                problems.push(`Rule "${ruleId}" (plugin "${id}") is not namespaced. Expected "<namespace>.<rule>".`);
                continue;
            }
            if (!ruleId.startsWith(`${ruleNamespace}.`)) {
                problems.push(`Rule "${ruleId}" (plugin "${id}") does not start with its declared namespace "${ruleNamespace}.".`);
                continue;
            }
            if (seenInPlugin.has(ruleId)) {
                problems.push(`Plugin "${id}" declares "${ruleId}" more than once.`);
                continue;
            }
            const owner = owners.get(ruleId);
            if (owner) {
                problems.push(`Rule "${ruleId}" is declared by both "${owner}" and "${id}".`);
                continue;
            }
            seenInPlugin.add(ruleId);
            owners.set(ruleId, id);
        }
    }
    return problems;
}
function collectDeclaredRuleIds(manifests) {
    const ids = new Set();
    for (const manifest of manifests) {
        for (const ruleId of manifest.ruleIds ?? []) {
            if (ruleId?.trim())
                ids.add(ruleId);
        }
    }
    return ids;
}
//# sourceMappingURL=rule-declarations.util.js.map