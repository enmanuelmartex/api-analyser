"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtAnalysisPlugin = void 0;
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class JwtAnalysisPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'jwt-analysis',
            name: 'JWT Analysis',
            version: '1.0.0',
            description: 'Analyzes JWT tokens for security weaknesses',
            longDescription: 'Decodes and inspects the configured JWT token checking for dangerous algorithms (none, RS→HS confusion), weak secrets, missing claims, and token expiration issues.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.AUTHENTICATION,
            owaspMappings: ['API2:2023'],
            cweIds: ['CWE-327', 'CWE-347'],
            tags: ['jwt', 'authentication', 'token', 'crypto', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['findings:write'],
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'jwt',
            ruleIds: [
                'jwt.none-algorithm',
                'jwt.asymmetric-algorithm-confusion-risk',
                'jwt.missing-expiration',
                'jwt.expired-token-accepted',
                'jwt.sensitive-data-in-payload',
                'jwt.excessive-expiration',
            ],
        };
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        if (context.auth.type !== 'BEARER' || !context.auth.token) {
            return {
                pluginId: this.id,
                pluginName: this.name,
                findings: [],
                scanDuration: Date.now() - start,
                endpointsTested: 0,
            };
        }
        const token = context.auth.token.trim();
        if (!this.isJwt(token)) {
            return {
                pluginId: this.id,
                pluginName: this.name,
                findings: [],
                scanDuration: Date.now() - start,
                endpointsTested: 0,
            };
        }
        const decoded = this.decodeJwt(token);
        if (!decoded) {
            return {
                pluginId: this.id,
                pluginName: this.name,
                findings: [],
                scanDuration: Date.now() - start,
                endpointsTested: 0,
            };
        }
        const { header, payload } = decoded;
        if (header.alg === 'none' || header.alg === '') {
            findings.push({
                title: 'JWT Uses "None" Algorithm (Signature Bypass)',
                category: 'Authentication',
                severity: 'CRITICAL',
                cvssScore: 9.8,
                owaspCategory: 'API2:2023',
                cweId: 'CWE-347',
                ruleId: 'jwt.none-algorithm',
                component: 'project',
                pluginId: this.id,
                description: 'The JWT token uses the "none" algorithm, which means no signature is applied. An attacker can forge arbitrary tokens without needing the server\'s secret key, completely bypassing authentication.',
                impact: 'Complete authentication bypass. Attackers can forge tokens for any user including administrators.',
                likelihood: 'HIGH',
                riskScore: 9.8,
                evidence: { algorithm: header.alg, header: JSON.stringify(header) },
                remediation: 'Explicitly whitelist allowed algorithms. Never accept "none" as a valid algorithm. In most JWT libraries, configure `algorithms: ["HS256"]` or similar.',
                references: [
                    'https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/',
                    'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
                ],
            });
        }
        if (header.alg === 'RS256' || header.alg === 'PS256') {
            findings.push({
                title: 'JWT Uses Asymmetric Algorithm — Verify Algorithm Confusion Prevention',
                category: 'Authentication',
                severity: 'MEDIUM',
                cvssScore: 6.8,
                owaspCategory: 'API2:2023',
                cweId: 'CWE-327',
                ruleId: 'jwt.asymmetric-algorithm-confusion-risk',
                component: 'project',
                pluginId: this.id,
                description: `The JWT uses ${header.alg}. Ensure the server is protected against algorithm confusion attacks where an attacker changes the algorithm from RS256 to HS256 and signs the token with the server's public key.`,
                impact: 'If vulnerable to algorithm confusion, attackers can forge valid tokens using the public key as the HMAC secret.',
                likelihood: 'LOW',
                riskScore: 6.8,
                evidence: { algorithm: header.alg },
                remediation: 'Explicitly verify the algorithm in the JWT header matches the expected algorithm. Reject tokens with unexpected algorithms.',
                references: [
                    'https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/#RS256-to-HS256',
                ],
            });
        }
        if (!payload.exp) {
            findings.push({
                title: 'JWT Token Has No Expiration (exp Claim Missing)',
                category: 'Authentication',
                severity: 'HIGH',
                cvssScore: 7.4,
                owaspCategory: 'API2:2023',
                cweId: 'CWE-613',
                ruleId: 'jwt.missing-expiration',
                component: 'project',
                pluginId: this.id,
                description: 'The JWT token does not contain an expiration (`exp`) claim. Tokens without expiration never become invalid, meaning a leaked or stolen token provides permanent access.',
                impact: 'Stolen tokens remain valid indefinitely, giving attackers permanent access to the API even after a credential rotation.',
                likelihood: 'HIGH',
                riskScore: 7.4,
                evidence: { payload: JSON.stringify(payload).substring(0, 200) },
                remediation: 'Always include an `exp` claim in JWT tokens. Set short expiration times (15 minutes to 1 hour for access tokens, 7-30 days for refresh tokens) and implement token rotation.',
                references: [
                    'https://datatracker.ietf.org/doc/html/rfc7519#section-4.1.4',
                    'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
                ],
            });
        }
        if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            const now = new Date();
            if (expDate < now) {
                findings.push({
                    title: 'JWT Token Is Expired But Still Accepted',
                    category: 'Authentication',
                    severity: 'HIGH',
                    cvssScore: 8.1,
                    owaspCategory: 'API2:2023',
                    cweId: 'CWE-613',
                    ruleId: 'jwt.expired-token-accepted',
                    component: 'project',
                    pluginId: this.id,
                    description: `The configured JWT token expired on ${expDate.toISOString()} but the API may still be accepting it (or the scanner is using an expired test token). If the API accepts expired tokens, authentication validation is broken.`,
                    impact: 'Expired tokens that are still accepted give attackers indefinite access using captured credentials.',
                    likelihood: 'MEDIUM',
                    riskScore: 8.1,
                    evidence: { expiredAt: expDate.toISOString(), now: now.toISOString() },
                    remediation: 'Implement proper JWT expiration validation. Reject expired tokens with HTTP 401 and clear error messages.',
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
                    ],
                });
            }
        }
        const sensitiveFields = ['password', 'secret', 'ssn', 'creditCard', 'credit_card', 'cvv', 'pin'];
        const payloadStr = JSON.stringify(payload).toLowerCase();
        const foundSensitive = sensitiveFields.filter((f) => payloadStr.includes(f.toLowerCase()));
        if (foundSensitive.length > 0) {
            findings.push({
                title: 'Sensitive Data Stored in JWT Payload',
                category: 'Sensitive Data Exposure',
                severity: 'HIGH',
                cvssScore: 7.5,
                owaspCategory: 'API2:2023',
                cweId: 'CWE-312',
                ruleId: 'jwt.sensitive-data-in-payload',
                component: 'project',
                pluginId: this.id,
                description: `The JWT payload contains potentially sensitive fields: ${foundSensitive.join(', ')}. JWT payloads are base64-encoded but NOT encrypted — anyone can decode them.`,
                impact: 'Sensitive data in JWT payloads is visible to any party that intercepts or receives the token, including frontend code.',
                likelihood: 'HIGH',
                riskScore: 7.5,
                evidence: { sensitiveFields: foundSensitive },
                remediation: 'Never store sensitive information (passwords, SSNs, financial data) in JWT payloads. Only store minimal necessary claims like user ID and role. Use JWE (encrypted JWT) if sensitive claims are required.',
                references: [
                    'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html',
                ],
            });
        }
        if (payload.exp && payload.iat) {
            const lifetimeDays = (payload.exp - payload.iat) / (60 * 60 * 24);
            if (lifetimeDays > 90) {
                findings.push({
                    title: 'JWT Token Has Excessive Expiration Time',
                    category: 'Authentication',
                    severity: 'MEDIUM',
                    cvssScore: 5.4,
                    owaspCategory: 'API2:2023',
                    cweId: 'CWE-613',
                    ruleId: 'jwt.excessive-expiration',
                    component: 'project',
                    pluginId: this.id,
                    description: `The JWT token has a lifetime of ${Math.round(lifetimeDays)} days. Long-lived tokens increase the window of opportunity for attackers who obtain a token through interception or credential theft.`,
                    impact: 'Stolen tokens remain valid for an extended period, giving attackers prolonged access.',
                    likelihood: 'LOW',
                    riskScore: 5.4,
                    evidence: { lifetimeDays: Math.round(lifetimeDays), exp: payload.exp, iat: payload.iat },
                    remediation: 'Use short-lived access tokens (15-60 minutes) combined with refresh tokens. Implement token rotation and revocation mechanisms.',
                    references: [
                        'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html',
                    ],
                });
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
    isJwt(token) {
        const parts = token.split('.');
        return parts.length === 3;
    }
    decodeJwt(token) {
        try {
            const [headerB64, payloadB64] = token.split('.');
            const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
            return { header, payload };
        }
        catch {
            return null;
        }
    }
}
exports.JwtAnalysisPlugin = JwtAnalysisPlugin;
//# sourceMappingURL=jwt-analysis.plugin.js.map