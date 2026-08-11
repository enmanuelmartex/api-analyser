"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDACTED = void 0;
exports.isSensitiveHeader = isSensitiveHeader;
exports.isSensitiveParam = isSensitiveParam;
exports.redactHeaders = redactHeaders;
exports.redactUrl = redactUrl;
exports.redactObject = redactObject;
exports.redactHttpMessage = redactHttpMessage;
exports.REDACTED = '[REDACTED]';
const SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'apikey',
    'x-auth-token',
    'x-access-token',
    'x-session-token',
    'x-csrf-token',
    'x-xsrf-token',
    'x-amz-security-token',
    'x-goog-api-key',
    'authentication',
]);
const SENSITIVE_PATTERNS = [
    'password',
    'passwd',
    'secret',
    'token',
    'credential',
    'private-key',
    'privatekey',
    'client-secret',
    'clientsecret',
    'session',
    'auth',
];
const SENSITIVE_PARAMS = [
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'apikey',
    'key',
    'secret',
    'client_secret',
    'password',
    'passwd',
    'pwd',
    'session',
    'sig',
    'signature',
];
function isSensitiveHeader(name) {
    const lower = name.toLowerCase().trim();
    if (SENSITIVE_HEADERS.has(lower))
        return true;
    return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern));
}
function isSensitiveParam(name) {
    const lower = name.toLowerCase().trim();
    return SENSITIVE_PARAMS.some((param) => lower === param || lower.includes(param));
}
function redactHeaders(headers) {
    if (!headers)
        return {};
    const safe = {};
    for (const [name, value] of Object.entries(headers)) {
        safe[name] = isSensitiveHeader(name) ? exports.REDACTED : String(value);
    }
    return safe;
}
function redactUrl(rawUrl) {
    const queryStart = rawUrl.indexOf('?');
    if (queryStart === -1)
        return rawUrl;
    const base = rawUrl.slice(0, queryStart);
    const query = rawUrl.slice(queryStart + 1);
    const [queryOnly, ...fragmentParts] = query.split('#');
    const fragment = fragmentParts.length ? `#${fragmentParts.join('#')}` : '';
    const redactedQuery = queryOnly
        .split('&')
        .filter(Boolean)
        .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1)
            return pair;
        const name = pair.slice(0, eq);
        return isSensitiveParam(decodeURIComponent(name))
            ? `${name}=${exports.REDACTED}`
            : pair;
    })
        .join('&');
    return redactedQuery ? `${base}?${redactedQuery}${fragment}` : `${base}${fragment}`;
}
function redactObject(value, depth = 0) {
    if (depth > 12 || value === null || value === undefined)
        return value;
    if (Array.isArray(value)) {
        return value.map((item) => redactObject(item, depth + 1));
    }
    if (typeof value !== 'object')
        return value;
    const result = {};
    for (const [key, val] of Object.entries(value)) {
        result[key] = isSensitiveParam(key) || isSensitiveHeader(key)
            ? exports.REDACTED
            : redactObject(val, depth + 1);
    }
    return result;
}
function redactHttpMessage(message) {
    if (!message)
        return message;
    return (message
        .replace(/^([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-session-token|authentication)[ \t]*:)[ \t]*.*$/gim, `$1 ${exports.REDACTED}`)
        .replace(/\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${exports.REDACTED}`)
        .replace(/("(?:[^"]*(?:password|passwd|secret|token|api_?key|credential)[^"]*)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, `$1"${exports.REDACTED}"`)
        .replace(/([?&](?:access_token|refresh_token|id_token|api_?key|token|client_secret|secret|password|sig|signature)=)[^&\s"']+/gi, `$1${exports.REDACTED}`));
}
//# sourceMappingURL=redact.util.js.map