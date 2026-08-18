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
      const evilOrigin = 'https://evil.com';
      const resp = await axios.options(url, {
        headers: {
          ...authHeaders,
          'Origin': evilOrigin,
          'Access-Control-Request-Method': 'DELETE',
          'Access-Control-Request-Headers': 'Authorization',
        },
        timeout: context.config.timeoutMs,
        validateStatus: () => true,
      });

      const allowedMethods = resp.headers['access-control-allow-methods'] ?? '';
      const advertisesDangerousMethod =
        /(^|,)\s*(delete|put|patch)\s*($|,)/i.test(allowedMethods) || allowedMethods.trim() === '*';

      if (advertisesDangerousMethod) {
        /*
         * Access-Control-Allow-Methods is emitted by CORS middleware sitting in
         * front of the whole API — a preflight for a route that has never heard
         * of DELETE still gets an answer, because the middleware doesn't know
         * what any specific route implements. Treating that list alone as proof
         * of a destructive vulnerability is what produced the false positive
         * this check used to report on every endpoint, dangerous method or not.
         *
         * Two more pieces of evidence, both obtainable without sending the
         * dangerous method itself, separate a real exposure from noise:
         *
         *   1. Would a browser actually deliver the real request? Only if THIS
         *      SAME preflight response's Access-Control-Allow-Origin accepted
         *      the attacker's origin. A server that ignores the requested
         *      Origin and always names its own frontend (or omits the header)
         *      blocks the browser from sending the follow-up request, no
         *      matter what Access-Control-Allow-Methods claims.
         *   2. Does the operation exist at all? The discovered specification
         *      already says which methods this exact path implements — DELETE
         *      is never sent live to find out, for the same reason the
         *      business-flow check never repeats one: this scanner does not
         *      get to decide a destructive call against someone else's system
         *      is worth the risk just to confirm a preflight header.
         */
        const preflightAcao = resp.headers['access-control-allow-origin'];
        const preflightAcac = resp.headers['access-control-allow-credentials'];
        const originAccepted = preflightAcao === evilOrigin || preflightAcao === '*';
        const credentialsExposed = preflightAcac === 'true' || preflightAcac === true;

        const requestedMethod = 'DELETE';
        const implementedOperation = context.endpoints.find(
          (e) => e.path === testEndpoint.path && e.method.toUpperCase() === requestedMethod,
        );
        const methodImplemented = Boolean(implementedOperation);
        const operationRequiresAuth = Boolean(
          implementedOperation &&
            Array.isArray(implementedOperation.security) &&
            implementedOperation.security.length > 0,
        );

        // Exploitable from an arbitrary origin only if the browser would both
        // deliver the request (origin accepted) and the server would act on it
        // (the method is a real, implemented operation on this path).
        const exploitable = originAccepted && methodImplemented;

        findings.push({
          title: exploitable
            ? `CORS Preflight Allows Cross-Origin ${requestedMethod} from an Untrusted Origin`
            : 'CORS Preflight Advertises Destructive Methods Regardless of Origin',
          category: 'Security Misconfiguration',
          severity: exploitable ? (credentialsExposed ? 'HIGH' : 'MEDIUM') : 'LOW',
          cvssScore: exploitable ? (credentialsExposed ? 7.4 : 5.8) : 3.1,
          owaspCategory: 'API8:2023',
          cweId: 'CWE-942',
          ruleId: 'cors.preflight-dangerous-methods',
          component: 'response-header:access-control-allow-methods',
          route: testEndpoint.path,
          method: testEndpoint.method,
          pluginId: this.id,
          affectedUrl: url,
          description: exploitable
            ? `The CORS preflight for ${testEndpoint.path} both accepts the untrusted origin "${evilOrigin}" (Access-Control-Allow-Origin: ${preflightAcao}) and advertises ${requestedMethod} in Access-Control-Allow-Methods (${allowedMethods}). The specification confirms ${requestedMethod} ${testEndpoint.path} is a real, implemented operation${operationRequiresAuth ? ', declared as requiring authentication in the specification — verify at runtime that the requirement is actually enforced' : ' with no declared authentication requirement'}. A browser at an arbitrary origin would be permitted to deliver that ${requestedMethod} request.`
            : `The CORS preflight for ${testEndpoint.path} lists ${requestedMethod} in Access-Control-Allow-Methods (${allowedMethods}), but that alone does not make it exploitable from an untrusted origin: ` +
              (!originAccepted
                ? `Access-Control-Allow-Origin (${preflightAcao ?? 'absent'}) does not accept the "${evilOrigin}" origin used in this probe, so a browser enforcing CORS would block the response and never send the real cross-origin request.`
                : `the discovered specification declares no ${requestedMethod} operation on ${testEndpoint.path}, so there is nothing for a cross-origin caller to invoke at this exact path even though CORS middleware shared across the API advertises the method on every preflight.`),
          impact: exploitable
            ? `A malicious website can trigger a cross-origin ${requestedMethod} request against this endpoint using an ordinary visitor's browser.`
            : 'None demonstrated at this endpoint. The Allow-Methods list reflects app-wide CORS configuration rather than what this specific route accepts, and the missing piece above (origin acceptance or a real operation) is what would have to change before this became exploitable.',
          likelihood: exploitable ? 'MEDIUM' : 'LOW',
          riskScore: exploitable ? (credentialsExposed ? 7.4 : 5.8) : 3.1,
          evidence: {
            testedOrigin: evilOrigin,
            requestedMethod,
            allowedMethods,
            preflightStatus: resp.status,
            accessControlAllowOrigin: preflightAcao ?? null,
            originAccepted,
            credentialsAllowed: credentialsExposed,
            methodImplementedInSpec: methodImplemented,
            operationRequiresAuthentication: operationRequiresAuth,
            confidence: exploitable ? 'HIGH' : 'LOW',
            note: `${requestedMethod} was never sent to the target — exploitability is inferred from this preflight's own Origin handling and from the discovered specification, not from a live destructive request.`,
          },
          httpRequest: this.buildRequestString('OPTIONS', url, {
            ...authHeaders,
            Origin: evilOrigin,
            'Access-Control-Request-Method': requestedMethod,
          }),
          httpResponse: this.buildResponseString(resp.status, resp.headers as any, null),
          remediation: exploitable
            ? `Scope Access-Control-Allow-Methods per route to what it actually implements, and never accept an untrusted origin for a state-changing method. Enforce authentication and ownership checks on ${requestedMethod} ${testEndpoint.path} independently of CORS — CORS is a browser-side relaxation, not an authorization mechanism.`
            : `Scope Access-Control-Allow-Methods per route to what it actually implements rather than advertising the full set on every preflight. It is not exploitable here today, but the mismatch invites confusion and stops being harmless the day a ${requestedMethod} operation is added at this exact path or the origin allowlist is loosened.`,
          references: [
            'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
            'https://portswigger.net/web-security/cors',
          ],
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
