import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';

export class CorsPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'cors',
    name: 'CORS Misconfiguration',
    version: '1.0.0',
    description: 'Tests for API8:2023 - Security Misconfiguration (CORS)',
    longDescription: 'Probes CORS configuration using malicious and crafted origins to detect wildcards combined with credentials, origin reflection, and permissive cross-origin policies.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.HEADERS,
    owaspMappings: ['API8:2023'],
    cweIds: ['CWE-346', 'CWE-942'],
    tags: ['cors', 'headers', 'misconfiguration', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'findings:write'],
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'cors',
    ruleIds: [
      'cors.wildcard-origin-with-credentials',
      'cors.reflects-arbitrary-origin',
      'cors.wildcard-origin',
      'cors.preflight-dangerous-methods',
    ],
  };

  private readonly testOrigins = [
    'https://evil.com',
    'https://attacker.example.com',
    'null',
    'https://trusted.com.evil.com',
    `${Math.random().toString(36).slice(2)}.attacker.com`,
  ];

  async run(context: ScanContext): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const authHeaders = this.getAuthHeaders(context.auth);

    const testEndpoint = context.endpoints.find((e) => e.method === 'GET') || context.endpoints[0];
    if (!testEndpoint) {
      return { pluginId: this.id, pluginName: this.name, findings: [], scanDuration: Date.now() - start, endpointsTested: 0 };
    }

    const url = this.buildUrl(context.baseUrl, this.fillPathParams(testEndpoint.path));

    for (const origin of this.testOrigins) {
      tested++;

      try {
        const resp = await axios.get(url, {
          headers: {
            ...authHeaders,
            'Origin': origin,
          },
          timeout: context.config.timeoutMs,
          validateStatus: () => true,
        });

        const acao = resp.headers['access-control-allow-origin'];
        const acac = resp.headers['access-control-allow-credentials'];

        // Wildcard with credentials
        if (acao === '*' && (acac === 'true' || acac === true)) {
          findings.push({
            title: 'CORS Wildcard Origin with Credentials Allowed',
            category: 'Security Misconfiguration',
            severity: 'CRITICAL',
            cvssScore: 9.0,
            owaspCategory: 'API8:2023',
            cweId: 'CWE-942',
            ruleId: 'cors.wildcard-origin-with-credentials',
            component: 'response-header:access-control-allow-origin',
            route: testEndpoint.path,
            method: testEndpoint.method,
            pluginId: this.id,
            endpointId: testEndpoint.id,
            affectedUrl: url,
            description: 'The API returns Access-Control-Allow-Origin: * (wildcard) combined with Access-Control-Allow-Credentials: true. Browsers reject this combination per the CORS spec, but some implementations incorrectly accept it, allowing any origin to make authenticated cross-origin requests.',
            impact: 'Any malicious website can make authenticated requests to the API on behalf of a logged-in user, leading to data theft and unauthorized actions.',
            likelihood: 'HIGH',
            riskScore: 9.0,
            evidence: { acao, acac, testedOrigin: origin },
            httpRequest: this.buildRequestString('GET', url, { ...authHeaders, Origin: origin }),
            httpResponse: this.buildResponseString(resp.status, resp.headers as any, null),
            remediation: 'Never use Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true. Use an explicit allowlist of trusted origins.',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
              'https://portswigger.net/web-security/cors',
            ],
          });
          break;
        }

        // Origin is reflected (any origin allowed)
        if (acao === origin) {
          findings.push({
            title: 'CORS Reflects Arbitrary Origin',
            category: 'Security Misconfiguration',
            severity: 'HIGH',
            cvssScore: 8.1,
            owaspCategory: 'API8:2023',
            cweId: 'CWE-942',
            ruleId: 'cors.reflects-arbitrary-origin',
            component: 'response-header:access-control-allow-origin',
            route: testEndpoint.path,
            method: testEndpoint.method,
            pluginId: this.id,
            endpointId: testEndpoint.id,
            affectedUrl: url,
            description: `The API reflected the attacker-controlled origin "${origin}" in the Access-Control-Allow-Origin response header. This means any website can make cross-origin requests to the API.`,
            impact: 'Cross-site request forgery, data theft via cross-origin reads, credential theft if combined with Allow-Credentials.',
            likelihood: 'HIGH',
            riskScore: 8.1,
            evidence: { acao, acac, testedOrigin: origin, isReflected: true },
            httpRequest: this.buildRequestString('GET', url, { ...authHeaders, Origin: origin }),
            httpResponse: this.buildResponseString(resp.status, resp.headers as any, null),
            remediation: `Implement a strict origin allowlist:
\`\`\`typescript
const allowedOrigins = ['https://app.yourdomain.com', 'https://yourdomain.com'];
app.enableCors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
});
\`\`\``,
            references: [
              'https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-Side_Testing/07-Testing_Cross_Origin_Resource_Sharing',
              'https://portswigger.net/web-security/cors/lab-reflect-any-origin',
            ],
          });
        }

        // Wildcard without credentials (lower severity)
        if (acao === '*' && (!acac || acac === 'false')) {
          findings.push({
            title: 'CORS Configured with Wildcard Origin',
            category: 'Security Misconfiguration',
            severity: 'MEDIUM',
            cvssScore: 5.4,
            owaspCategory: 'API8:2023',
            cweId: 'CWE-942',
            ruleId: 'cors.wildcard-origin',
            component: 'response-header:access-control-allow-origin',
            route: testEndpoint.path,
            method: testEndpoint.method,
            pluginId: this.id,
            endpointId: testEndpoint.id,
            affectedUrl: url,
            description: 'The API uses a wildcard (*) Access-Control-Allow-Origin header without credentials. While less severe, this allows any web page to read API responses, which may expose data not intended for public access.',
            impact: 'Any web origin can make cross-origin GET requests and read the responses.',
            likelihood: 'MEDIUM',
            riskScore: 5.4,
            evidence: { acao, testedOrigin: origin },
            remediation: 'Restrict CORS to specific trusted origins rather than using wildcards.',
            references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
          });
          break;
        }
      } catch (_) {}

      await this.delay(context.config.requestDelayMs);
    }

    // Test OPTIONS preflight
    tested++;
    try {
      const resp = await axios.options(url, {
        headers: {
          ...authHeaders,
          'Origin': 'https://evil.com',
          'Access-Control-Request-Method': 'DELETE',
          'Access-Control-Request-Headers': 'Authorization',
        },
        timeout: context.config.timeoutMs,
        validateStatus: () => true,
      });

      const allowedMethods = resp.headers['access-control-allow-methods'];
      if (allowedMethods?.includes('DELETE') || allowedMethods?.includes('*')) {
        findings.push({
          title: 'CORS Preflight Allows Dangerous HTTP Methods from Any Origin',
          category: 'Security Misconfiguration',
          severity: 'HIGH',
          cvssScore: 7.4,
          owaspCategory: 'API8:2023',
          ruleId: 'cors.preflight-dangerous-methods',
          component: 'response-header:access-control-allow-methods',
          route: testEndpoint.path,
          method: testEndpoint.method,
          pluginId: this.id,
          affectedUrl: url,
          description: `The CORS preflight response allows the DELETE method from cross-origin requests (Access-Control-Allow-Methods: ${allowedMethods}).`,
          impact: 'Allows cross-origin DELETE requests which can lead to data deletion by malicious websites.',
          likelihood: 'MEDIUM',
          riskScore: 7.4,
          evidence: { allowedMethods, preflightStatus: resp.status },
          remediation: 'Restrict allowed methods in CORS preflight to only those necessary (GET, POST). Never allow DELETE or PUT from untrusted origins.',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
        });
      }
    } catch (_) {}

    return {
      pluginId: this.id,
      pluginName: this.name,
      findings,
      scanDuration: Date.now() - start,
      endpointsTested: tested,
    };
  }
}
