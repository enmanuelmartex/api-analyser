"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsrfPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class SsrfPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'ssrf',
            name: 'Server-Side Request Forgery',
            version: '1.0.0',
            description: 'Tests for API7:2023 - Server-Side Request Forgery (SSRF)',
            longDescription: 'Injects malicious URLs (localhost, AWS metadata endpoint, file://) into URL-accepting parameters to detect SSRF vulnerabilities that could expose internal infrastructure.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.INFRASTRUCTURE,
            owaspMappings: ['API7:2023'],
            cweIds: ['CWE-918'],
            tags: ['ssrf', 'infrastructure', 'cloud', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'http:write', 'findings:write'],
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'ssrf',
            ruleIds: [
                'ssrf.cloud-metadata-accessible',
                'ssrf.body-url-parameter',
            ],
        };
        this.ssrfPayloads = [
            'http://169.254.169.254/latest/meta-data/',
            'http://169.254.169.254/latest/user-data/',
            'http://metadata.google.internal/computeMetadata/v1/',
            'http://100.100.100.200/latest/meta-data/',
            'http://localhost:22',
            'http://localhost:3306',
            'http://127.0.0.1:6379',
            'http://[::1]/',
            'http://0.0.0.0/',
        ];
        this.urlParamNames = [
            'url', 'uri', 'href', 'redirect', 'return', 'returnUrl',
            'return_url', 'callback', 'callbackUrl', 'callback_url',
            'next', 'destination', 'dest', 'target', 'image', 'imageUrl',
            'image_url', 'avatar', 'profile', 'logo', 'icon', 'file',
            'path', 'source', 'src', 'feed', 'webhook', 'proxy',
        ];
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const authHeaders = this.getAuthHeaders(context.auth);
        for (const endpoint of context.endpoints.slice(0, 10)) {
            const params = (endpoint.parameters || []);
            const urlParams = params.filter((p) => this.urlParamNames.some((name) => p.name?.toLowerCase().includes(name.toLowerCase())));
            for (const param of urlParams) {
                tested++;
                for (const payload of this.ssrfPayloads.slice(0, 3)) {
                    const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path), param.in === 'query' ? { [param.name]: payload } : undefined);
                    try {
                        const resp = await axios_1.default.request({
                            method: endpoint.method,
                            url,
                            headers: authHeaders,
                            timeout: 5000,
                            validateStatus: () => true,
                        });
                        const respBody = JSON.stringify(resp.data || '').toLowerCase();
                        const isMetadataLeak = respBody.includes('ami-id') ||
                            respBody.includes('instance-id') ||
                            respBody.includes('security-groups') ||
                            respBody.includes('iam') ||
                            respBody.includes('computeMetadata') ||
                            respBody.includes('root:');
                        if (isMetadataLeak || (resp.status === 200 && respBody.length > 100)) {
                            findings.push({
                                title: 'Server-Side Request Forgery (SSRF) — Cloud Metadata Accessible',
                                category: 'SSRF',
                                severity: 'CRITICAL',
                                cvssScore: 10.0,
                                owaspCategory: 'API7:2023',
                                cweId: 'CWE-918',
                                ruleId: 'ssrf.cloud-metadata-accessible',
                                component: 'query:url-parameter',
                                route: endpoint.path,
                                method: endpoint.method,
                                pluginId: this.id,
                                endpointId: endpoint.id,
                                affectedUrl: `${endpoint.method} ${url}`,
                                description: `The parameter "${param.name}" on ${endpoint.method} ${endpoint.path} appears to accept URLs. When set to "${payload}" (cloud metadata endpoint), the server made an internal request that returned a non-error response, potentially leaking cloud instance metadata.`,
                                impact: 'SSRF can lead to cloud credentials theft (AWS IAM, GCP service accounts), internal network scanning, access to internal services, remote code execution, and complete infrastructure compromise.',
                                likelihood: 'HIGH',
                                riskScore: 10.0,
                                evidence: {
                                    parameter: param.name,
                                    ssrfPayload: payload,
                                    responseStatus: resp.status,
                                    responsePreview: respBody.substring(0, 200),
                                },
                                httpRequest: this.buildRequestString(endpoint.method, url, authHeaders),
                                httpResponse: this.buildResponseString(resp.status, resp.headers, respBody.substring(0, 300)),
                                remediation: `Prevent SSRF:
1. Validate and sanitize all URL inputs
2. Use allowlists for permitted hosts/URLs
3. Block internal IP ranges and cloud metadata endpoints
4. Implement network-level controls (firewall rules blocking internal metadata endpoints)
5. Use a URL parsing library to validate URLs before making requests

Example (NestJS):
\`\`\`typescript
const BLOCKED_RANGES = ['169.254.', '10.', '192.168.', '172.16.', '127.', 'localhost'];

function isSsrfUrl(url: string): boolean {
  const parsed = new URL(url);
  return BLOCKED_RANGES.some(range => parsed.hostname.startsWith(range));
}
\`\`\``,
                                references: [
                                    'https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/',
                                    'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
                                    'https://cwe.mitre.org/data/definitions/918.html',
                                ],
                            });
                            break;
                        }
                    }
                    catch (_) { }
                    await this.delay(context.config.requestDelayMs);
                }
            }
            if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                const schema = endpoint.requestBody?.content?.['application/json']?.schema?.properties || {};
                const urlBodyParams = Object.keys(schema).filter((key) => this.urlParamNames.some((name) => key.toLowerCase().includes(name.toLowerCase())));
                if (urlBodyParams.length > 0) {
                    tested++;
                    const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
                    const payload = this.ssrfPayloads[0];
                    const body = {};
                    for (const param of urlBodyParams) {
                        body[param] = payload;
                    }
                    try {
                        const resp = await axios_1.default.request({
                            method: endpoint.method,
                            url,
                            headers: { ...authHeaders, 'Content-Type': 'application/json' },
                            data: body,
                            timeout: 5000,
                            validateStatus: () => true,
                        });
                        if (resp.status < 400) {
                            findings.push({
                                title: 'Potential SSRF via Request Body URL Parameter',
                                category: 'SSRF',
                                severity: 'HIGH',
                                cvssScore: 8.6,
                                owaspCategory: 'API7:2023',
                                cweId: 'CWE-918',
                                pluginId: this.id,
                                endpointId: endpoint.id,
                                affectedUrl: `${endpoint.method} ${url}`,
                                description: `The endpoint ${endpoint.method} ${endpoint.path} accepts URL parameters in the request body (${urlBodyParams.join(', ')}). If not validated, these could be used to trigger server-side requests to internal resources.`,
                                ruleId: 'ssrf.body-url-parameter',
                                component: 'body:url-parameter',
                                route: endpoint.path,
                                method: endpoint.method,
                                impact: 'Attackers can make the server fetch arbitrary URLs, potentially accessing internal services, cloud metadata, or other resources.',
                                likelihood: 'MEDIUM',
                                riskScore: 8.6,
                                evidence: { urlParams: urlBodyParams, ssrfPayload: payload, responseStatus: resp.status },
                                remediation: 'Validate all URL parameters in request bodies. Implement allowlisting and block access to internal IP ranges.',
                                references: ['https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/'],
                            });
                        }
                    }
                    catch (_) { }
                }
            }
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
exports.SsrfPlugin = SsrfPlugin;
//# sourceMappingURL=ssrf.plugin.js.map