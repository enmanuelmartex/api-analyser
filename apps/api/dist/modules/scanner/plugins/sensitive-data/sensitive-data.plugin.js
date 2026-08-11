"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensitiveDataPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class SensitiveDataPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'sensitive-data',
            name: 'Sensitive Data Exposure',
            version: '1.0.0',
            description: 'Tests for API3:2023 and API8:2023 - Sensitive data in API responses',
            longDescription: 'Scans API responses for regex patterns matching credit card numbers, SSNs, private keys, AWS access keys, and generic secrets accidentally returned in payloads.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.COMPLIANCE,
            owaspMappings: ['API3:2023', 'API8:2023'],
            cweIds: ['CWE-200', 'CWE-312'],
            tags: ['sensitive-data', 'pii', 'secrets', 'compliance', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'findings:write'],
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'sensitive-data',
            ruleIds: [
                'sensitive-data.credit-card',
                'sensitive-data.ssn',
                'sensitive-data.private-key',
                'sensitive-data.aws-access-key',
                'sensitive-data.password-in-response',
                'sensitive-data.jwt-in-response',
                'sensitive-data.api-key-or-secret',
                'sensitive-data.bulk-email-addresses',
                'sensitive-data.internal-ip-address',
                'sensitive-data.stack-trace',
            ],
        };
        this.patterns = [
            {
                name: 'Credit Card Number',
                ruleId: 'sensitive-data.credit-card',
                pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
                severity: 'CRITICAL',
                cvssScore: 9.1,
                description: 'Credit card number detected in API response',
                cweId: 'CWE-359',
            },
            {
                name: 'Social Security Number',
                ruleId: 'sensitive-data.ssn',
                pattern: /\b\d{3}-\d{2}-\d{4}\b/,
                severity: 'CRITICAL',
                cvssScore: 9.1,
                description: 'Social Security Number (SSN) pattern detected in API response',
                cweId: 'CWE-359',
            },
            {
                name: 'Private Key',
                ruleId: 'sensitive-data.private-key',
                pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
                severity: 'CRITICAL',
                cvssScore: 10.0,
                description: 'Private key material detected in API response',
                cweId: 'CWE-321',
            },
            {
                name: 'AWS Access Key',
                ruleId: 'sensitive-data.aws-access-key',
                pattern: /(?:AKIA|AIPA|ASIA|AROA|ABIA|ACCA)[A-Z0-9]{16}/,
                severity: 'CRITICAL',
                cvssScore: 10.0,
                description: 'AWS access key detected in API response',
                cweId: 'CWE-798',
            },
            {
                name: 'Password in Response',
                ruleId: 'sensitive-data.password-in-response',
                pattern: /"password"\s*:\s*"[^"]{3,}"/i,
                severity: 'CRITICAL',
                cvssScore: 9.8,
                description: 'Password field with value detected in API response',
                cweId: 'CWE-312',
            },
            {
                name: 'JWT Token in Response',
                ruleId: 'sensitive-data.jwt-in-response',
                pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
                severity: 'HIGH',
                cvssScore: 7.5,
                description: 'JWT token embedded in API response body',
                cweId: 'CWE-312',
            },
            {
                name: 'API Key or Secret',
                ruleId: 'sensitive-data.api-key-or-secret',
                pattern: /"(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token)"\s*:\s*"[^"]{8,}"/i,
                severity: 'HIGH',
                cvssScore: 8.5,
                description: 'API key or secret credential detected in API response',
                cweId: 'CWE-798',
            },
            {
                name: 'Email Address (Bulk)',
                ruleId: 'sensitive-data.bulk-email-addresses',
                pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
                severity: 'MEDIUM',
                cvssScore: 5.3,
                description: 'Email addresses detected in API response',
                cweId: 'CWE-359',
            },
            {
                name: 'Internal IP Address',
                ruleId: 'sensitive-data.internal-ip-address',
                pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/,
                severity: 'LOW',
                cvssScore: 3.7,
                description: 'Internal/private IP address detected in API response, indicating potential information disclosure',
                cweId: 'CWE-200',
            },
            {
                name: 'Stack Trace',
                ruleId: 'sensitive-data.stack-trace',
                pattern: /(?:at\s+\w+\.\w+\([^)]+:\d+:\d+\)|Exception in thread|Traceback \(most recent call last\)|Error: .+ at Object\.<anonymous>)/,
                severity: 'MEDIUM',
                cvssScore: 5.3,
                description: 'Stack trace or error details detected in API response — reveals internal implementation details',
                cweId: 'CWE-209',
            },
        ];
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const authHeaders = this.getAuthHeaders(context.auth);
        const getEndpoints = context.endpoints
            .filter((e) => e.method === 'GET')
            .slice(0, 10);
        for (const endpoint of getEndpoints) {
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            tested++;
            try {
                const resp = await axios_1.default.get(url, {
                    headers: authHeaders,
                    timeout: context.config.timeoutMs,
                    validateStatus: () => true,
                });
                if (resp.status >= 400)
                    continue;
                const responseBody = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
                for (const check of this.patterns) {
                    const matches = responseBody.match(check.pattern);
                    if (matches) {
                        const sample = matches[0].substring(0, 50);
                        const masked = this.maskSensitiveValue(sample);
                        const alreadyFound = findings.some((f) => f.ruleId === check.ruleId && f.endpointId === endpoint.id);
                        if (alreadyFound)
                            continue;
                        findings.push({
                            title: `Sensitive Data Exposure: ${check.name}`,
                            category: 'Sensitive Data Exposure',
                            severity: check.severity,
                            cvssScore: check.cvssScore,
                            owaspCategory: 'API3:2023',
                            cweId: check.cweId,
                            pluginId: this.id,
                            ruleId: check.ruleId,
                            component: 'response-body',
                            route: endpoint.path,
                            method: endpoint.method,
                            endpointId: endpoint.id,
                            affectedUrl: `GET ${url}`,
                            description: `${check.description} at endpoint ${endpoint.method} ${endpoint.path}. Sensitive data should never be included in API responses unless absolutely necessary and properly authorized.`,
                            impact: 'Exposure of sensitive data can lead to identity theft, financial fraud, account takeover, compliance violations (GDPR, PCI-DSS, HIPAA), and reputational damage.',
                            likelihood: 'HIGH',
                            riskScore: check.cvssScore,
                            evidence: {
                                detectedPattern: check.name,
                                sampleValue: masked,
                                matchCount: Array.isArray(matches) ? matches.length : 1,
                                endpoint: endpoint.path,
                            },
                            httpRequest: this.buildRequestString('GET', url, authHeaders),
                            httpResponse: this.buildResponseString(resp.status, resp.headers, '[REDACTED — Contains sensitive data]'),
                            remediation: `Prevent sensitive data exposure:
1. Apply data minimization — only return fields the client needs
2. Filter sensitive fields from API responses using DTOs/serializers
3. Never return passwords, secrets, or credentials in responses
4. Implement response field filtering based on user role
5. Audit API responses regularly for sensitive data leakage

Example (NestJS with @Exclude):
\`\`\`typescript
export class UserDto {
  id: string;
  email: string;
  name: string;

  @Exclude()
  password: string;  // Never returned

  @Exclude()
  apiKey: string;    // Never returned
}
\`\`\``,
                            references: [
                                'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/',
                                'https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html',
                                'https://cwe.mitre.org/data/definitions/359.html',
                            ],
                        });
                    }
                }
            }
            catch (_) { }
            await this.delay(context.config.requestDelayMs);
        }
        return {
            pluginId: this.id,
            pluginName: this.name,
            findings,
            scanDuration: Date.now() - start,
            endpointsTested: tested,
        };
    }
    maskSensitiveValue(value) {
        if (value.length <= 6)
            return '***';
        return value.substring(0, 3) + '*'.repeat(value.length - 6) + value.substring(value.length - 3);
    }
}
exports.SensitiveDataPlugin = SensitiveDataPlugin;
//# sourceMappingURL=sensitive-data.plugin.js.map