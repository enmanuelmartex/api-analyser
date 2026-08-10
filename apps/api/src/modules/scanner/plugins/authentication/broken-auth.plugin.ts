import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';

export class BrokenAuthPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'broken-authentication',
    name: 'Broken Authentication',
    version: '1.0.0',
    description: 'Tests for API2:2023 - Broken Authentication vulnerabilities',
    longDescription: 'Attempts to access protected endpoints without credentials and with malformed tokens to detect missing or weak authentication controls.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.AUTHENTICATION,
    owaspMappings: ['API2:2023'],
    cweIds: ['CWE-287', 'CWE-306'],
    tags: ['authentication', 'authorization', 'jwt', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'http:write', 'findings:write'],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'auth',
    ruleIds: [
      'auth.missing-authentication',
      'auth.accepts-invalid-token',
    ],
  };

  async run(context: ScanContext): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    // No `getAuthHeaders` call here on purpose: both checks below are about
    // what the target accepts *without* valid credentials — one sends no
    // Authorization header at all, the other a deliberately malformed token.
    // Sending the project's real credentials would defeat both.
    const testEndpoints = context.endpoints
      .filter((e) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(e.method))
      .slice(0, 15);

    for (const endpoint of testEndpoints) {
      if (endpoint.deprecated) continue;

      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      tested++;

      // Test 1: No authentication
      try {
        const resp = await axios.request({
          method: endpoint.method as any,
          url,
          headers: { 'User-Agent': appBrand.scannerUserAgent, 'Accept': 'application/json' },
          timeout: context.config.timeoutMs,
          validateStatus: () => true,
        });

        if (resp.status < 400) {
          findings.push({
            title: 'Endpoint Accessible Without Authentication',
            category: 'Broken Authentication',
            severity: endpoint.method !== 'GET' ? 'HIGH' : 'MEDIUM',
            cvssScore: endpoint.method !== 'GET' ? 7.5 : 5.3,
            owaspCategory: 'API2:2023',
            cweId: 'CWE-306',
            pluginId: this.id,
            ruleId: 'auth.missing-authentication',
            component: 'endpoint',
            route: endpoint.path,
            method: endpoint.method,
            endpointId: endpoint.id,
            affectedUrl: `${endpoint.method} ${url}`,
            description: `The endpoint ${endpoint.method} ${endpoint.path} returns a ${resp.status} response without any authentication credentials. This means the endpoint is publicly accessible and may expose sensitive data or functionality.`,
            impact: 'Unauthenticated users can access protected resources, potentially exposing sensitive data, performing unauthorized actions, or enumerating internal data.',
            likelihood: endpoint.method !== 'GET' ? 'HIGH' : 'MEDIUM',
            riskScore: endpoint.method !== 'GET' ? 7.5 : 5.3,
            evidence: {
              requestMethod: endpoint.method,
              requestUrl: url,
              responseStatus: resp.status,
              authUsed: 'None',
            },
            httpRequest: this.buildRequestString(
              endpoint.method,
              url,
              { 'User-Agent': appBrand.scannerUserAgent, Accept: 'application/json' },
            ),
            httpResponse: this.buildResponseString(
              resp.status,
              resp.headers as any,
              typeof resp.data === 'object' ? JSON.stringify(resp.data).substring(0, 500) : String(resp.data).substring(0, 500),
            ),
            remediation: 'Implement authentication middleware that validates credentials before processing requests. Use JWT, OAuth2, or API Keys consistently across all protected endpoints. Return 401 for missing credentials and 403 for insufficient permissions.',
            references: [
              'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
              'https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html',
            ],
          });
        }
      } catch (_) {}

      // Test 2: Invalid/Malformed token
      if (context.auth.type === 'BEARER') {
        try {
          const resp = await axios.request({
            method: endpoint.method as any,
            url,
            headers: {
              'Authorization': 'Bearer invalid.token.here',
              'User-Agent': appBrand.scannerUserAgent,
              'Accept': 'application/json',
            },
            timeout: context.config.timeoutMs,
            validateStatus: () => true,
          });

          if (resp.status < 400) {
            findings.push({
              title: 'Endpoint Accepts Invalid Authentication Token',
              category: 'Broken Authentication',
              severity: 'CRITICAL',
              cvssScore: 9.1,
              owaspCategory: 'API2:2023',
              cweId: 'CWE-287',
              pluginId: this.id,
              ruleId: 'auth.accepts-invalid-token',
              component: 'header:authorization',
              route: endpoint.path,
              method: endpoint.method,
              endpointId: endpoint.id,
              affectedUrl: `${endpoint.method} ${url}`,
              description: `The endpoint ${endpoint.method} ${endpoint.path} returned ${resp.status} when called with a clearly malformed JWT token (invalid.token.here). This indicates the server is not properly validating authentication tokens.`,
              impact: 'Attackers can bypass authentication by crafting malformed tokens, gaining unauthorized access to the API.',
              likelihood: 'HIGH',
              riskScore: 9.1,
              evidence: {
                tokenUsed: 'invalid.token.here',
                responseStatus: resp.status,
              },
              httpRequest: this.buildRequestString(endpoint.method, url, {
                Authorization: 'Bearer invalid.token.here',
                'User-Agent': appBrand.scannerUserAgent,
              }),
              httpResponse: this.buildResponseString(resp.status, resp.headers as any, null),
              remediation: 'Implement strict JWT/token validation including signature verification, expiration checks, and issuer validation. Reject all malformed or invalid tokens with a 401 response.',
              references: [
                'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
                'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html',
              ],
            });
          }
        } catch (_) {}
      }

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
}
