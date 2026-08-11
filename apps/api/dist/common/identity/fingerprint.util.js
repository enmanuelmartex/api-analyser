"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_COMPONENT = exports.GLOBAL_ROUTE = exports.GLOBAL_METHOD = exports.FINGERPRINT_VERSION = void 0;
exports.normalizeMethod = normalizeMethod;
exports.normalizeRoute = normalizeRoute;
exports.normalizeComponent = normalizeComponent;
exports.buildCanonicalString = buildCanonicalString;
exports.computeFingerprint = computeFingerprint;
exports.computeOccurrenceKey = computeOccurrenceKey;
const crypto_1 = require("crypto");
exports.FINGERPRINT_VERSION = 'v1';
exports.GLOBAL_METHOD = 'GLOBAL';
exports.GLOBAL_ROUTE = '/';
exports.GLOBAL_COMPONENT = 'project';
const HTTP_METHODS = new Set([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE',
]);
const PARAM_COLON = /^:(.+)$/;
const PARAM_ANGLE = /^<(.+)>$/;
const PARAM_BRACE = /^\{(.+)\}$/;
const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_SEGMENT = /^[0-9a-f]{24,}$/i;
function normalizeMethod(method) {
    if (!method)
        return exports.GLOBAL_METHOD;
    const upper = method.trim().toUpperCase();
    return HTTP_METHODS.has(upper) ? upper : exports.GLOBAL_METHOD;
}
function normalizeRoute(route) {
    if (!route)
        return exports.GLOBAL_ROUTE;
    let path = route.trim();
    if (path === '')
        return exports.GLOBAL_ROUTE;
    const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(path);
    if (schemeMatch)
        path = schemeMatch[1] ?? '/';
    path = path.split('#')[0].split('?')[0];
    const segments = path
        .split('/')
        .filter((segment) => segment !== '')
        .map(normalizeSegment);
    return segments.length === 0 ? exports.GLOBAL_ROUTE : `/${segments.join('/')}`;
}
function normalizeSegment(segment) {
    const colon = PARAM_COLON.exec(segment);
    if (colon)
        return `{${colon[1]}}`;
    const angle = PARAM_ANGLE.exec(segment);
    if (angle)
        return `{${angle[1]}}`;
    const brace = PARAM_BRACE.exec(segment);
    if (brace)
        return `{${brace[1]}}`;
    if (NUMERIC_SEGMENT.test(segment) || UUID_SEGMENT.test(segment) || HEX_ID_SEGMENT.test(segment)) {
        return '{id}';
    }
    return segment;
}
function normalizeComponent(component) {
    if (!component)
        return 'endpoint';
    const normalized = component.trim().toLowerCase().replace(/\s+/g, '-');
    return normalized === '' ? 'endpoint' : normalized;
}
function buildCanonicalString(parts) {
    return [
        exports.FINGERPRINT_VERSION,
        parts.projectId,
        parts.pluginId,
        parts.ruleId,
        parts.method,
        parts.normalizedRoute,
        parts.component,
    ].join('|');
}
function computeFingerprint(input) {
    const projectId = requireNonEmpty(input.projectId, 'projectId');
    const pluginId = requireNonEmpty(input.pluginId, 'pluginId');
    const ruleId = requireNonEmpty(input.ruleId, 'ruleId');
    const method = normalizeMethod(input.method);
    const normalizedRoute = method === exports.GLOBAL_METHOD && !input.route ? exports.GLOBAL_ROUTE : normalizeRoute(input.route);
    const component = normalizeComponent(input.component);
    const parts = {
        projectId,
        pluginId,
        ruleId,
        method,
        normalizedRoute,
        component,
    };
    const canonical = buildCanonicalString(parts);
    return {
        ...parts,
        canonical,
        fingerprint: sha256Hex(canonical),
        fingerprintVersion: exports.FINGERPRINT_VERSION,
    };
}
function computeOccurrenceKey(fingerprintVersion, fingerprint) {
    return sha256Hex(`${fingerprintVersion}|${fingerprint}`);
}
function sha256Hex(value) {
    return (0, crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
}
function requireNonEmpty(value, field) {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error(`Cannot compute a fingerprint without ${field}.`);
    }
    return trimmed;
}
//# sourceMappingURL=fingerprint.util.js.map