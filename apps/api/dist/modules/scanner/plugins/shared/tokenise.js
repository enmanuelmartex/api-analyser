"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.singularise = singularise;
exports.tokenise = tokenise;
function singularise(token) {
    if (token.length > 3 && token.endsWith('ies'))
        return `${token.slice(0, -3)}y`;
    if (token.length > 4 && (token.endsWith('ses') || token.endsWith('xes'))) {
        return token.slice(0, -2);
    }
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
        return token.slice(0, -1);
    }
    return token;
}
function tokenise(text) {
    return text
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularise);
}
//# sourceMappingURL=tokenise.js.map