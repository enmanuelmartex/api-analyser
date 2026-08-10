import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';

export class MassAssignmentPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'mass-assignment',
    name: 'Mass Assignment',
    version: '1.0.0',
    description: 'Tests for API3:2023 - Broken Object Property Level Authorization (Mass Assignment)',
    longDescription: 'Submits POST/PUT requests with extra privileged fields (isAdmin, role, price, etc.) not defined in the spec to detect APIs that blindly bind all incoming properties.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.AUTHORIZATION,
    owaspMappings: ['API3:2023'],
    cweIds: ['CWE-915'],
    tags: ['mass-assignment', 'injection', 'authorization', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:write', 'findings:write'],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'mass-assignment',
    ruleIds: [
      'mass-assignment.unrestricted-property-binding',
    ],
  };

  private readonly privilegedFields = [
    'isAdmin', 'is_admin', 'role', 'roles', 'admin', 'superuser',
    'privilege', 'permissions', 'verified', 'emailVerified', 'email_verified',
    'active', 'isActive', 'is_active', 'balance', 'credit', 'credits',
    'subscription', 'plan', 'tier', 'vip', 'isPremium', 'is_premium',
    'internalNote', 'internal_note', 'score', 'rating',
  ];

  async run(context: ScanContext): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const authHeaders = {
      ...this.getAuthHeaders(context.auth),
      'Content-Type': 'application/json',
    };

    const writableEndpoints = context.endpoints.filter(
      (e) => ['POST', 'PUT', 'PATCH'].includes(e.method),
    ).slice(0, 8);

    for (const endpoint of writableEndpoints) {
      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      tested++;

      const requestBody: Record<string, any> = {};
      for (const field of this.privilegedFields) {
        requestBody[field] = true;
      }
      requestBody['isAdmin'] = true;
      requestBody['role'] = 'admin';
      requestBody['balance'] = 999999;
      requestBody['credits'] = 9999;
      requestBody['plan'] = 'enterprise';

      if (endpoint.requestBody?.content?.['application/json']?.schema?.properties) {
        const legitFields = endpoint.requestBody.content['application/json'].schema.properties;
        Object.assign(requestBody, Object.fromEntries(
          Object.entries(legitFields).slice(0, 3).map(([k]) => [k, 'test']),
        ));
      }

      try {
        const resp = await axios.request({
          method: endpoint.method as any,
          url,
          headers: authHeaders,
          data: requestBody,
          timeout: context.config.timeoutMs,
          validateStatus: () => true,
        });

        if (resp.status >= 200 && resp.status < 300) {
          const responseStr = JSON.stringify(resp.data || {});
          const acceptedPrivilegedFields = this.privilegedFields.filter(
            (field) => responseStr.includes(field) || responseStr.includes('"admin":true') || responseStr.includes('"isAdmin":true'),
          );

          if (acceptedPrivilegedFields.length > 0 || resp.status === 200 || resp.status === 201) {
            findings.push({
              title: 'Potential Mass Assignment Vulnerability',
              category: 'Authorization',
              severity: 'HIGH',
              cvssScore: 8.8,
              owaspCategory: 'API3:2023',
              cweId: 'CWE-915',
              ruleId: 'mass-assignment.unrestricted-property-binding',
              component: 'request-body',
              route: endpoint.path,
              method: endpoint.method,
              pluginId: this.id,
              endpointId: endpoint.id,
              affectedUrl: `${endpoint.method} ${url}`,
              description: `The endpoint ${endpoint.method} ${endpoint.path} accepted a request body containing privileged fields (${this.privilegedFields.slice(0, 5).join(', ')}, ...) and returned HTTP ${resp.status}. If the API assigns these fields directly from user input, an attacker could elevate their privileges.`,
              impact: 'Attackers can set their own account role to "admin", give themselves unlimited credits, bypass subscription restrictions, or manipulate any field that is passed through to the data model.',
              likelihood: 'MEDIUM',
              riskScore: 8.8,
              evidence: {
                injectedFields: this.privilegedFields.slice(0, 8),
                responseStatus: resp.status,
                endpoint: endpoint.path,
                method: endpoint.method,
                responsePreview: responseStr.substring(0, 300),
              },
              httpRequest: this.buildRequestString(endpoint.method, url, authHeaders, requestBody),
              httpResponse: this.buildResponseString(resp.status, resp.headers as any, responseStr.substring(0, 300)),
              remediation: `Prevent mass assignment:
1. Use DTOs (Data Transfer Objects) to explicitly define accepted fields
2. Never pass request body directly to database/ORM layer
3. Use allowlisting (never denylisting) for accepted fields

Example (NestJS):
\`\`\`typescript
// BAD - mass assignment vulnerability
async updateUser(id: string, body: any) {
  return this.userRepo.update(id, body); // Never do this!
}

// GOOD - explicit DTO
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
  // role, isAdmin, etc. are NOT in the DTO
}
\`\`\``,
              references: [
                'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/',
                'https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html',
                'https://cwe.mitre.org/data/definitions/915.html',
              ],
            });
          }
        }
      } catch (_) {}

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
