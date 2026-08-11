"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityHeadersPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class SecurityHeadersPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'security-headers',
            name: 'Security Headers',
            version: '1.0.0',
            description: 'Tests for API8:2023 - Security Misconfiguration (HTTP Security Headers)',
            longDescription: 'Audits HTTP response headers for the presence and correct configuration of security directives such as HSTS, CSP, X-Content-Type-Options, and X-Frame-Options.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.HEADERS,
            owaspMappings: ['API8:2023'],
            cweIds: ['CWE-693', 'CWE-1021'],
            tags: ['headers', 'misconfiguration', 'hsts', 'csp', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'findings:write'],
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'headers',
            ruleIds: [
                'headers.missing-hsts',
                'headers.missing-x-content-type-options',
                'headers.missing-x-frame-options',
                'headers.missing-content-security-policy',
                'headers.missing-referrer-policy',
                'headers.missing-cache-control',
                'headers.discloses-x-powered-by',
                'headers.discloses-server',
            ],
        };
        this.checks = [
            {
                header: 'strict-transport-security',
                missingRuleId: 'headers.missing-hsts',
                required: true,
                severity: 'HIGH',
                cvssScore: 7.4,
                description: 'HSTS header is missing. Without HSTS, clients may connect over insecure HTTP, allowing man-in-the-middle attacks.',
                remediation: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
                goodExample: 'max-age=31536000; includeSubDomains',
            },
            {
                header: 'x-content-type-options',
                missingRuleId: 'headers.missing-x-content-type-options',
                required: true,
                severity: 'MEDIUM',
                cvssScore: 5.1,
                description: 'X-Content-Type-Options header is missing. Browsers may perform MIME-type sniffing, leading to XSS attacks.',
                remediation: 'Add X-Content-Type-Options: nosniff to all responses',
                goodExample: 'nosniff',
            },
            {
                header: 'x-frame-options',
                missingRuleId: 'headers.missing-x-frame-options',
                required: true,
                severity: 'MEDIUM',
                cvssScore: 4.3,
                description: 'X-Frame-Options header is missing. The API responses can be embedded in frames, enabling clickjacking attacks.',
                remediation: 'Add X-Frame-Options: DENY for APIs',
                goodExample: 'DENY',
            },
            {
                header: 'content-security-policy',
                missingRuleId: 'headers.missing-content-security-policy',
                required: false,
                severity: 'MEDIUM',
                cvssScore: 5.4,
                description: 'Content-Security-Policy header is missing. While primarily for HTML responses, APIs returning JSON should still set CSP.',
                remediation: "Add Content-Security-Policy: default-src 'none'; frame-ancestors 'none'",
                goodExample: "default-src 'none'; frame-ancestors 'none'",
            },
            {
                header: 'referrer-policy',
                missingRuleId: 'headers.missing-referrer-policy',
                required: false,
                severity: 'LOW',
                cvssScore: 3.1,
                description: 'Referrer-Policy header is missing. Without this header, sensitive URL information may be leaked in Referer headers.',
                remediation: 'Add Referrer-Policy: no-referrer or strict-origin-when-cross-origin',
                goodExample: 'no-referrer',
            },
            {
                header: 'cache-control',
                missingRuleId: 'headers.missing-cache-control',
                required: true,
                severity: 'MEDIUM',
                cvssScore: 5.3,
                description: 'Cache-Control header is missing or not set to prevent caching. API responses containing sensitive data may be cached.',
                remediation: 'Add Cache-Control: no-store, no-cache, must-revalidate for authenticated API endpoints',
                goodExample: 'no-store',
            },
            {
                header: 'x-powered-by',
                disclosureRuleId: 'headers.discloses-x-powered-by',
                required: false,
                severity: 'INFO',
                cvssScore: 2.1,
                description: 'X-Powered-By header reveals server technology information, helping attackers identify vulnerabilities.',
                remediation: 'Remove X-Powered-By header. In Express: app.disable("x-powered-by"). In NestJS with helmet: this is handled automatically.',
                badValues: ['express', 'php', 'asp.net', 'django'],
            },
            {
                header: 'server',
                disclosureRuleId: 'headers.discloses-server',
                required: false,
                severity: 'INFO',
                cvssScore: 2.1,
                description: 'Server header reveals web server version, aiding fingerprinting and targeted attacks.',
                remediation: 'Remove or obfuscate the Server header in your web server configuration.',
                badValues: ['nginx', 'apache', 'iis', 'kestrel'],
            },
        ];
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        const testEndpoint = context.endpoints.find((e) => e.method === 'GET') || context.endpoints[0];
        if (!testEndpoint) {
            return { pluginId: this.id, pluginName: this.name, findings: [], scanDuration: Date.now() - start, endpointsTested: 0 };
        }
        const url = this.buildUrl(context.baseUrl, this.fillPathParams(testEndpoint.path));
        const authHeaders = this.getAuthHeaders(context.auth);
        let responseHeaders = {};
        let responseStatus = 0;
        try {
            const resp = await axios_1.default.get(url, {
                headers: authHeaders,
                timeout: context.config.timeoutMs,
                validateStatus: () => true,
            });
            responseHeaders = resp.headers;
            responseStatus = resp.status;
        }
        catch (error) {
            return {
                pluginId: this.id,
                pluginName: this.name,
                findings: [],
                scanDuration: Date.now() - start,
                endpointsTested: 1,
                error: `Failed to connect: ${error.message}`,
            };
        }
        const lowerHeaders = Object.fromEntries(Object.entries(responseHeaders).map(([k, v]) => [k.toLowerCase(), v]));
        for (const check of this.checks) {
            const headerValue = lowerHeaders[check.header];
            if (!headerValue && check.required && check.missingRuleId) {
                findings.push({
                    title: `Missing Security Header: ${check.header.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-')}`,
                    category: 'Security Misconfiguration',
                    severity: check.severity,
                    cvssScore: check.cvssScore,
                    owaspCategory: 'API8:2023',
                    cweId: 'CWE-693',
                    pluginId: this.id,
                    ruleId: check.missingRuleId,
                    component: `response-header:${check.header}`,
                    route: testEndpoint.path,
                    method: testEndpoint.method,
                    endpointId: testEndpoint.id,
                    affectedUrl: url,
                    description: check.description,
                    impact: 'Missing security headers weaken the overall security posture and may expose users to browser-based attacks.',
                    likelihood: 'MEDIUM',
                    riskScore: check.cvssScore,
                    evidence: {
                        missingHeader: check.header,
                        url,
                        goodExample: check.goodExample,
                        existingHeaders: Object.keys(lowerHeaders).filter((h) => h.startsWith('x-') || h === 'content-security-policy'),
                    },
                    httpResponse: this.buildResponseString(responseStatus, responseHeaders, null),
                    remediation: check.remediation,
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/',
                        'https://securityheaders.com',
                        'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html',
                    ],
                });
            }
            else if (headerValue && check.badValues && check.disclosureRuleId) {
                const valueLower = headerValue.toString().toLowerCase();
                const isBad = check.badValues.some((bad) => valueLower.includes(bad));
                if (isBad) {
                    findings.push({
                        title: `Information Disclosure via ${check.header} Header`,
                        category: 'Security Misconfiguration',
                        severity: check.severity,
                        cvssScore: check.cvssScore,
                        owaspCategory: 'API8:2023',
                        cweId: 'CWE-200',
                        pluginId: this.id,
                        ruleId: check.disclosureRuleId,
                        component: `response-header:${check.header}`,
                        route: testEndpoint.path,
                        method: testEndpoint.method,
                        endpointId: testEndpoint.id,
                        affectedUrl: url,
                        description: `${check.header}: ${headerValue} — ${check.description}`,
                        impact: 'Server technology disclosure helps attackers identify known vulnerabilities for the specific version.',
                        likelihood: 'LOW',
                        riskScore: check.cvssScore,
                        evidence: { header: check.header, value: headerValue },
                        remediation: check.remediation,
                        references: ['https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/'],
                    });
                }
            }
        }
        return {
            pluginId: this.id,
            pluginName: this.name,
            findings,
            scanDuration: Date.now() - start,
            endpointsTested: 1,
        };
    }
}
exports.SecurityHeadersPlugin = SecurityHeadersPlugin;
//# sourceMappingURL=security-headers.plugin.js.map