"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class RateLimitPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'rate-limit',
            name: 'Rate Limiting',
            version: '1.0.0',
            description: 'Tests for API4:2023 - Unrestricted Resource Consumption (Rate Limiting)',
            longDescription: 'Fires bursts of rapid requests against selected endpoints and checks for 429 responses or rate-limit headers to detect missing throttling controls.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.PERFORMANCE,
            owaspMappings: ['API4:2023'],
            cweIds: ['CWE-770', 'CWE-400'],
            tags: ['rate-limit', 'performance', 'dos', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'http:write', 'findings:write'],
            configFields: [
                { key: 'requestCount', label: 'Requests per burst', type: 'number', default: 25, min: 5, max: 100 },
            ],
            defaultConfig: { requestCount: 25 },
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'rate-limit',
            ruleIds: [
                'rate-limit.absent',
                'rate-limit.missing-headers',
            ],
        };
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const authHeaders = this.getAuthHeaders(context.auth);
        const testEndpoints = context.endpoints
            .filter((e) => ['GET', 'POST'].includes(e.method))
            .slice(0, 3);
        for (const endpoint of testEndpoints) {
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            const numRequests = 25;
            const responses = [];
            const responseHeaders = [];
            tested++;
            const requestStart = Date.now();
            await Promise.all(Array.from({ length: numRequests }, async () => {
                try {
                    const resp = await axios_1.default.request({
                        method: endpoint.method,
                        url,
                        headers: authHeaders,
                        timeout: 5000,
                        validateStatus: () => true,
                    });
                    responses.push(resp.status);
                    responseHeaders.push(resp.headers);
                }
                catch {
                    responses.push(0);
                }
            }));
            const duration = Date.now() - requestStart;
            const rateLimited = responses.filter((s) => s === 429).length;
            const successCount = responses.filter((s) => s >= 200 && s < 300).length;
            const lastHeaders = responseHeaders[responseHeaders.length - 1] || {};
            const hasRateLimitHeaders = !!(lastHeaders['x-ratelimit-limit'] ||
                lastHeaders['x-rate-limit-limit'] ||
                lastHeaders['ratelimit-limit'] ||
                lastHeaders['x-ratelimit-remaining'] ||
                lastHeaders['retry-after']);
            if (rateLimited === 0 && successCount > numRequests * 0.8) {
                findings.push({
                    title: 'No Rate Limiting Detected',
                    category: 'Resource Consumption',
                    severity: 'HIGH',
                    cvssScore: 7.5,
                    owaspCategory: 'API4:2023',
                    cweId: 'CWE-770',
                    ruleId: 'rate-limit.absent',
                    component: 'endpoint',
                    route: endpoint.path,
                    method: endpoint.method,
                    pluginId: this.id,
                    endpointId: endpoint.id,
                    affectedUrl: `${endpoint.method} ${url}`,
                    description: `Sent ${numRequests} rapid requests to ${endpoint.method} ${endpoint.path} in ${duration}ms. All ${successCount} succeeded with no rate limiting (HTTP 429) responses detected and no rate limit headers present. This allows attackers to send unlimited requests.`,
                    impact: 'Without rate limiting, attackers can: perform brute force attacks on authentication endpoints, scrape all data from the API, cause denial of service by exhausting server resources, and harvest sensitive information at scale.',
                    likelihood: 'HIGH',
                    riskScore: 7.5,
                    evidence: {
                        requestsSent: numRequests,
                        successfulRequests: successCount,
                        rateLimitedRequests: rateLimited,
                        durationMs: duration,
                        hasRateLimitHeaders,
                        url,
                        ratePerSecond: Math.round((numRequests / duration) * 1000),
                    },
                    httpRequest: this.buildRequestString(endpoint.method, url, authHeaders),
                    httpResponse: this.buildResponseString(responses[0] || 200, responseHeaders[0] || {}, null),
                    remediation: `Implement rate limiting for all API endpoints:
1. Use a rate limiting middleware (e.g., express-rate-limit, nestjs/throttler)
2. Return 429 Too Many Requests with Retry-After header when limit exceeded
3. Implement per-user and per-IP rate limits
4. Add rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)

Example (NestJS with @nestjs/throttler):
\`\`\`typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Controller('auth')
export class AuthController {}
\`\`\``,
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/',
                        'https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html',
                    ],
                });
            }
            else if (!hasRateLimitHeaders && rateLimited > 0) {
                findings.push({
                    title: 'Rate Limiting Present But Missing Rate Limit Headers',
                    category: 'Resource Consumption',
                    severity: 'LOW',
                    cvssScore: 3.1,
                    owaspCategory: 'API4:2023',
                    ruleId: 'rate-limit.missing-headers',
                    component: 'response-header:x-ratelimit-limit',
                    route: endpoint.path,
                    method: endpoint.method,
                    pluginId: this.id,
                    endpointId: endpoint.id,
                    affectedUrl: `${endpoint.method} ${url}`,
                    description: `Rate limiting is enforced (received ${rateLimited} HTTP 429 responses) but no standard rate limit headers are returned. Without these headers, clients cannot implement backoff strategies.`,
                    impact: 'API clients cannot gracefully handle rate limits, leading to poor user experience and potential retry storms.',
                    likelihood: 'LOW',
                    riskScore: 3.1,
                    evidence: { rateLimitedRequests: rateLimited, hasRateLimitHeaders: false },
                    remediation: 'Add rate limit response headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After.',
                    references: [
                        'https://tools.ietf.org/id/draft-polli-ratelimit-headers-00.html',
                    ],
                });
            }
            await this.delay(1000);
        }
        return {
            pluginId: this.id,
            pluginName: this.name,
            findings,
            scanDuration: Date.now() - start,
            endpointsTested: tested,
        };
    }
}
exports.RateLimitPlugin = RateLimitPlugin;
//# sourceMappingURL=rate-limit.plugin.js.map