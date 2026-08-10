import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';

export class BolaPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'bola',
    name: 'Broken Object Level Authorization',
    version: '1.0.0',
    description: 'Tests for API1:2023 - BOLA/IDOR vulnerabilities',
    longDescription: 'Probes endpoints with ID path parameters using multiple object IDs to detect missing ownership checks that allow accessing other users\' resources.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.AUTHORIZATION,
    owaspMappings: ['API1:2023'],
    cweIds: ['CWE-284', 'CWE-639'],
    tags: ['authorization', 'bola', 'idor', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'findings:write'],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'bola',
    ruleIds: [
      'bola.unprotected-object-reference',
    ],
  };

  private readonly idPatterns = [
    /\{id\}/i, /\{userId\}/i, /\{user_id\}/i,
    /\{orderId\}/i, /\{order_id\}/i, /\{accountId\}/i,
    /\{resourceId\}/i, /\{uuid\}/i, /\{guid\}/i,
    /\{documentId\}/i, /\{fileId\}/i, /\{recordId\}/i,
  ];

  async run(context: ScanContext): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const authHeaders = this.getAuthHeaders(context.auth);

    const idEndpoints = context.endpoints.filter((e) =>
      this.idPatterns.some((pattern) => pattern.test(e.path)) &&
      ['GET', 'PUT', 'PATCH', 'DELETE'].includes(e.method),
    );

    for (const endpoint of idEndpoints.slice(0, 10)) {
      const testIds = ['1', '2', '3', '100', '999', 'admin', '00000000-0000-0000-0000-000000000001'];

      for (const testId of testIds.slice(0, 3)) {
        const filledPath = endpoint.path.replace(/\{[^}]+\}/g, testId);
        const url = this.buildUrl(context.baseUrl, filledPath);
        tested++;

        try {
          const resp = await axios.request({
            method: endpoint.method as any,
            url,
            headers: authHeaders,
            timeout: context.config.timeoutMs,
            validateStatus: () => true,
          });

          if (resp.status === 200 && this.containsUserData(resp.data)) {
            findings.push({
              title: 'Potential Broken Object Level Authorization (IDOR)',
              category: 'Authorization',
              severity: 'HIGH',
              cvssScore: 8.1,
              cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N',
              owaspCategory: 'API1:2023',
              cweId: 'CWE-639',
              pluginId: this.id,
              ruleId: 'bola.unprotected-object-reference',
              component: 'path:param',
              route: endpoint.path,
              method: endpoint.method,
              endpointId: endpoint.id,
              affectedUrl: `${endpoint.method} ${url}`,
              description: `The endpoint ${endpoint.method} ${endpoint.path} returned HTTP 200 with data when accessed with ID "${testId}". This suggests the API may not be validating object ownership, potentially allowing unauthorized access to resources belonging to other users.`,
              impact: 'Attackers can enumerate resource IDs to access data belonging to other users, leading to data breaches, privacy violations, and unauthorized data manipulation.',
              likelihood: 'HIGH',
              riskScore: 8.1,
              evidence: {
                testedId: testId,
                endpoint: endpoint.path,
                responseStatus: resp.status,
                responsePreview: JSON.stringify(resp.data).substring(0, 300),
                hasUserData: this.containsUserData(resp.data),
              },
              httpRequest: this.buildRequestString(endpoint.method, url, authHeaders),
              httpResponse: this.buildResponseString(
                resp.status,
                resp.headers as any,
                JSON.stringify(resp.data).substring(0, 500),
              ),
              remediation: `Implement object-level authorization checks:
1. Verify the authenticated user owns or has permission to access the requested resource
2. Never rely on client-provided IDs without server-side validation
3. Use indirect references (map user-specific IDs to actual IDs server-side)
4. Log authorization failures for security monitoring

Example (NestJS):
\`\`\`typescript
@Get(':id')
async getResource(@Param('id') id: string, @CurrentUser() user: User) {
  const resource = await this.service.findOne(id);
  if (resource.userId !== user.id) {
    throw new ForbiddenException('Access denied');
  }
  return resource;
}
\`\`\``,
              references: [
                'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/',
                'https://cwe.mitre.org/data/definitions/639.html',
                'https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html',
              ],
            });
            break;
          }
        } catch (_) {}

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

  private containsUserData(data: any): boolean {
    if (!data) return false;
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const sensitiveFields = ['email', 'phone', 'name', 'address', 'ssn', 'dob', 'userId', 'user_id', 'account'];
    return sensitiveFields.some((field) => str.toLowerCase().includes(field));
  }
}
