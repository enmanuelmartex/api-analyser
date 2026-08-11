"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BflaPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
class BflaPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'bfla',
            name: 'Broken Function Level Authorization',
            version: '1.0.0',
            description: 'Tests for API5:2023 - Broken Function Level Authorization',
            longDescription: 'Detects endpoints that expose administrative or elevated-privilege operations to regular users by probing admin-pattern paths without appropriate authorization.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.AUTHORIZATION,
            owaspMappings: ['API5:2023'],
            cweIds: ['CWE-285', 'CWE-648'],
            tags: ['authorization', 'bfla', 'privilege-escalation', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'http:write', 'findings:write'],
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'bfla',
            ruleIds: [
                'bfla.admin-endpoint-accessible',
                'bfla.http-method-escalation',
            ],
        };
        this.adminPaths = [
            '/admin', '/admin/', '/api/admin', '/management', '/internal',
            '/superuser', '/root', '/system', '/private', '/restricted',
            '/dashboard/admin', '/users/admin', '/control', '/ops',
            '/v1/admin', '/v2/admin', '/api/v1/admin', '/api/v2/admin',
        ];
        this.adminOperations = [
            'delete', 'deactivate', 'ban', 'approve', 'reject', 'promote',
            'demote', 'impersonate', 'reset', 'purge', 'export-all',
        ];
    }
    async run(context) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const authHeaders = this.getAuthHeaders(context.auth);
        for (const adminPath of this.adminPaths.slice(0, 8)) {
            const url = this.buildUrl(context.baseUrl, adminPath);
            tested++;
            try {
                const resp = await axios_1.default.get(url, {
                    headers: authHeaders,
                    timeout: context.config.timeoutMs,
                    validateStatus: () => true,
                });
                if (resp.status < 404) {
                    findings.push({
                        title: 'Potentially Accessible Administrative Endpoint',
                        category: 'Authorization',
                        severity: resp.status < 300 ? 'CRITICAL' : 'MEDIUM',
                        cvssScore: resp.status < 300 ? 9.8 : 5.4,
                        owaspCategory: 'API5:2023',
                        cweId: 'CWE-285',
                        pluginId: this.id,
                        ruleId: 'bfla.admin-endpoint-accessible',
                        component: 'endpoint',
                        route: adminPath,
                        method: 'GET',
                        affectedUrl: `GET ${url}`,
                        description: `The administrative endpoint GET ${adminPath} returned HTTP ${resp.status}. Administrative functions should be protected with role-based access controls and should not be accessible to regular authenticated users.`,
                        impact: 'Regular users may be able to perform administrative actions including user management, data deletion, and system configuration changes.',
                        likelihood: resp.status < 300 ? 'HIGH' : 'MEDIUM',
                        riskScore: resp.status < 300 ? 9.8 : 5.4,
                        evidence: { url, responseStatus: resp.status, adminPath },
                        httpRequest: this.buildRequestString('GET', url, authHeaders),
                        httpResponse: this.buildResponseString(resp.status, resp.headers, null),
                        remediation: 'Implement role-based access control (RBAC) to restrict administrative functions. Verify user roles and permissions server-side for every request to administrative endpoints.',
                        references: [
                            'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/',
                            'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html',
                        ],
                    });
                }
            }
            catch (_) { }
            await this.delay(context.config.requestDelayMs);
        }
        const getEndpoints = context.endpoints.filter((e) => e.method === 'GET').slice(0, 5);
        for (const endpoint of getEndpoints) {
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            for (const method of ['DELETE', 'PUT', 'PATCH']) {
                tested++;
                try {
                    const resp = await axios_1.default.request({
                        method: method,
                        url,
                        headers: { ...authHeaders, 'Content-Type': 'application/json' },
                        data: { test: 'api-analyser-scan' },
                        timeout: context.config.timeoutMs,
                        validateStatus: () => true,
                    });
                    if (resp.status < 400) {
                        findings.push({
                            title: 'HTTP Method Escalation — Unauthorized Action Permitted',
                            category: 'Authorization',
                            severity: 'HIGH',
                            cvssScore: 7.5,
                            owaspCategory: 'API5:2023',
                            cweId: 'CWE-285',
                            pluginId: this.id,
                            ruleId: 'bfla.http-method-escalation',
                            component: `method:${method.toLowerCase()}`,
                            route: endpoint.path,
                            method: endpoint.method,
                            endpointId: endpoint.id,
                            affectedUrl: `${method} ${url}`,
                            description: `Sending a ${method} request to ${endpoint.path} (originally documented as GET-only) returned HTTP ${resp.status}. This suggests function-level authorization is not enforced for this HTTP method.`,
                            impact: 'Attackers may perform unauthorized write/delete operations by using undocumented HTTP methods on endpoints.',
                            likelihood: 'MEDIUM',
                            riskScore: 7.5,
                            evidence: { method, url, responseStatus: resp.status, originalMethod: 'GET' },
                            remediation: 'Explicitly whitelist allowed HTTP methods for each endpoint. Return 405 Method Not Allowed for disallowed methods.',
                            references: [
                                'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/',
                            ],
                        });
                    }
                }
                catch (_) { }
                await this.delay(context.config.requestDelayMs);
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
exports.BflaPlugin = BflaPlugin;
//# sourceMappingURL=bfla.plugin.js.map