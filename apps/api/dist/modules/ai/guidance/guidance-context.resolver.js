"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuidanceContextResolver = void 0;
const common_1 = require("@nestjs/common");
const HEADER_SIGNATURES = [
    { header: 'x-powered-by', pattern: /express/i, name: 'express', label: 'Express', confidence: 'DETECTED' },
    { header: 'x-powered-by', pattern: /asp\.net/i, name: 'asp.net', label: 'ASP.NET Core', confidence: 'DETECTED' },
    { header: 'x-powered-by', pattern: /next\.js/i, name: 'express', label: 'Next.js (Node)', confidence: 'DETECTED' },
    { header: 'x-powered-by', pattern: /php/i, name: 'php', label: 'PHP', confidence: 'DETECTED' },
    { header: 'server', pattern: /gunicorn|uvicorn/i, name: 'fastapi', label: 'Python ASGI/WSGI', confidence: 'INFERRED' },
    { header: 'server', pattern: /kestrel/i, name: 'asp.net', label: 'ASP.NET Core (Kestrel)', confidence: 'DETECTED' },
    { header: 'server', pattern: /nginx/i, name: 'nginx', label: 'nginx', confidence: 'DETECTED' },
    { header: 'server', pattern: /apache/i, name: 'apache', label: 'Apache', confidence: 'DETECTED' },
    { header: 'server', pattern: /cloudflare/i, name: 'cloudflare', label: 'Cloudflare', confidence: 'DETECTED' },
    { header: 'server', pattern: /awselb|amazon/i, name: 'aws', label: 'AWS', confidence: 'DETECTED' },
    { header: 'x-amzn-requestid', pattern: /./, name: 'aws', label: 'AWS API Gateway', confidence: 'DETECTED' },
    { header: 'x-amz-apigw-id', pattern: /./, name: 'aws', label: 'AWS API Gateway', confidence: 'DETECTED' },
    { header: 'x-azure-ref', pattern: /./, name: 'azure', label: 'Azure', confidence: 'DETECTED' },
    { header: 'x-ms-request-id', pattern: /./, name: 'azure', label: 'Azure', confidence: 'DETECTED' },
    { header: 'x-goog-trace', pattern: /./, name: 'gcp', label: 'Google Cloud', confidence: 'DETECTED' },
    { header: 'x-cloud-trace-context', pattern: /./, name: 'gcp', label: 'Google Cloud', confidence: 'DETECTED' },
    { header: 'x-django-version', pattern: /./, name: 'django', label: 'Django', confidence: 'DETECTED' },
];
const COOKIE_SIGNATURES = [
    { pattern: /\bconnect\.sid\b/i, name: 'express', label: 'Express (session cookie)' },
    { pattern: /\bsessionid\b/i, name: 'django', label: 'Django (session cookie)' },
    { pattern: /\bcsrftoken\b/i, name: 'django', label: 'Django (CSRF cookie)' },
    { pattern: /\bJSESSIONID\b/i, name: 'spring', label: 'Java servlet container' },
    { pattern: /\b\.AspNetCore\./i, name: 'asp.net', label: 'ASP.NET Core' },
    { pattern: /\blaravel_session\b/i, name: 'php', label: 'Laravel' },
];
let GuidanceContextResolver = class GuidanceContextResolver {
    resolve(input) {
        const found = new Map();
        const add = (technology) => {
            const existing = found.get(technology.name);
            if (!existing || rank(technology.confidence) > rank(existing.confidence)) {
                found.set(technology.name, technology);
            }
        };
        if (input.declaredStack) {
            for (const token of tokenise(input.declaredStack)) {
                add({
                    name: token,
                    label: token,
                    confidence: 'USER_CONFIGURED',
                    evidence: 'Declared in the project configuration',
                });
            }
        }
        const headers = parseHeaders(input.httpResponse);
        for (const signature of HEADER_SIGNATURES) {
            const value = headers.get(signature.header);
            if (value && signature.pattern.test(value)) {
                add({
                    name: signature.name,
                    label: signature.label,
                    confidence: signature.confidence,
                    evidence: `Response header ${signature.header}: ${value.slice(0, 80)}`,
                });
            }
        }
        const cookies = headers.get('set-cookie');
        if (cookies) {
            for (const signature of COOKIE_SIGNATURES) {
                if (signature.pattern.test(cookies)) {
                    add({
                        name: signature.name,
                        label: signature.label,
                        confidence: 'INFERRED',
                        evidence: 'Inferred from a session cookie name',
                    });
                }
            }
        }
        if (input.authType && input.authType !== 'NONE') {
            const name = input.authType.toLowerCase() === 'bearer' ? 'jwt' : input.authType.toLowerCase();
            add({
                name,
                label: input.authType,
                confidence: 'USER_CONFIGURED',
                evidence: 'Authentication type configured for this project',
            });
        }
        const technologies = [...found.values()].sort((a, b) => rank(b.confidence) - rank(a.confidence));
        return {
            technologies,
            allowed: new Map(technologies.map((t) => [t.name.toLowerCase(), t.confidence])),
            isUnknown: technologies.length === 0,
        };
    }
};
exports.GuidanceContextResolver = GuidanceContextResolver;
exports.GuidanceContextResolver = GuidanceContextResolver = __decorate([
    (0, common_1.Injectable)()
], GuidanceContextResolver);
function rank(confidence) {
    switch (confidence) {
        case 'USER_CONFIGURED':
            return 3;
        case 'DETECTED':
            return 2;
        case 'INFERRED':
            return 1;
        default:
            return 0;
    }
}
function tokenise(value) {
    return value
        .toLowerCase()
        .split(/[,;/|]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 1)
        .slice(0, 8);
}
function parseHeaders(httpResponse) {
    const headers = new Map();
    if (!httpResponse)
        return headers;
    const [head] = httpResponse.split(/\n\s*\n/, 1);
    for (const line of head.split('\n').slice(1)) {
        const separator = line.indexOf(':');
        if (separator <= 0)
            continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (!key || !value)
            continue;
        headers.set(key, headers.has(key) ? `${headers.get(key)}; ${value}` : value);
    }
    return headers;
}
//# sourceMappingURL=guidance-context.resolver.js.map