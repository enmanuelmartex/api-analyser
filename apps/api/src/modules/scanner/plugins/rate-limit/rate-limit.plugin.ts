import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding, ParsedEndpoint } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';
import { tokenise } from '../shared/tokenise';

/**
 * Path terms whose missing rate limit matters more than an arbitrary
 * endpoint's: authentication and account-lifecycle operations are exactly
 * what brute force and credential stuffing target.
 *
 * `business-flow.no-anti-automation` (the API6 check) deliberately excludes
 * login/logout/OAuth from its own classification — see
 * `business-flow-classifier.ts` — on the basis that this check covers them
 * instead. That division of labor only holds if this check reliably reaches
 * them, which "the first 3 GET/POST endpoints in whatever order the spec
 * happens to list them" does not guarantee. This list is what makes the
 * guarantee real without probing every endpoint in every scan.
 */
const SENSITIVE_PATH_TERMS = ['login', 'signin', 'signup', 'register', 'token', 'password', 'otp', 'mfa', 'authenticate'];

/** The header names (already lowercased) that indicate rate-limit bookkeeping. */
const RATE_LIMIT_HEADER_NAMES = [
  'x-ratelimit-limit', 'x-rate-limit-limit', 'ratelimit-limit',
  'x-ratelimit-remaining', 'retry-after',
];

/** Exported for direct unit testing — see rate-limit.plugin.spec.ts. */
export function hasRateLimitHeaders(headers: Record<string, unknown>): boolean {
  return RATE_LIMIT_HEADER_NAMES.some((name) => Boolean(headers[name]));
}

/** Exported for direct unit testing — see rate-limit.plugin.spec.ts. */
export function isSensitiveEndpoint(path: string): boolean {
  const tokens = tokenise(path ?? '');
  if (tokens.some((token) => SENSITIVE_PATH_TERMS.includes(token))) return true;
  // Hyphenated "sign-in"/"sign-up" tokenise to ["sign", "in"/"up"] rather than
  // a single word — see the same handling in business-flow-classifier.ts.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'sign' && (tokens[i + 1] === 'in' || tokens[i + 1] === 'up')) return true;
  }
  return false;
}

export class RateLimitPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'rate-limit',
    name: 'Rate Limiting',
    version: '1.0.0',
    description: 'Tests for API4:2023 - Unrestricted Resource Consumption (Rate Limiting)',
    longDescription: 'Fires bursts of rapid requests against selected endpoints and checks for 429 responses or rate-limit headers to detect missing throttling controls.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.PERFORMANCE,
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

  async run(context: ScanContext): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const authHeaders = this.getAuthHeaders(context.auth);

    // Sensitive endpoints (login, register, token exchange...) go first, so
    // they are never crowded out of the 3-endpoint cap by whatever happens to
    // appear earlier in the specification.
    const candidates = context.endpoints.filter((e) => ['GET', 'POST'].includes(e.method));
    const sensitive: ParsedEndpoint[] = [];
    const rest: ParsedEndpoint[] = [];
    for (const endpoint of candidates) {
      (isSensitiveEndpoint(endpoint.path) ? sensitive : rest).push(endpoint);
    }
    const testEndpoints = [...sensitive, ...rest].slice(0, 3);

    for (const endpoint of testEndpoints) {
      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      const numRequests = 25;
      /*
       * Status and headers as one record per request, pushed together — never
       * two parallel arrays. They used to be separate (`responses`,
       * `responseHeaders`), and a network error pushed a status but no headers
       * entry, which silently misaligned every index after the first failure.
       */
      const results: { status: number; headers: Record<string, unknown> }[] = [];

      tested++;

      const requestStart = Date.now();

      await Promise.all(
        Array.from({ length: numRequests }, async () => {
          try {
            const resp = await axios.request({
              method: endpoint.method as any,
              url,
              headers: authHeaders,
              timeout: 5000,
              validateStatus: () => true,
            });
            results.push({ status: resp.status, headers: resp.headers as any });
          } catch {
            results.push({ status: 0, headers: {} });
          }
        }),
      );

      const duration = Date.now() - requestStart;
      const responses = results.map((r) => r.status);
      const rateLimitedResponses = results.filter((r) => r.status === 429);
      const rateLimited = rateLimitedResponses.length;
      const successCount = responses.filter((s) => s >= 200 && s < 300).length;

      /*
       * Whether ANY 429 response carried rate-limit headers — not whichever
       * request's promise happened to settle last. These 25 requests run
       * concurrently (`Promise.all`), so completion order is not send order:
       * the one that finishes last is frequently a 200/401 that raced ahead of
       * a slower request, and checking only that one meant the "missing
       * headers" finding could fire against an API that puts `Retry-After` on
       * every 429 it sends, simply because the sampled response wasn't a 429
       * at all. A real gap in header behavior would still show up here, since
       * it would mean none of the 429s — not just one unlucky sample — carry
       * them.
       */
      const rateLimitHeadersPresent = rateLimitedResponses.some((r) => hasRateLimitHeaders(r.headers));

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
            hasRateLimitHeaders: rateLimitHeadersPresent,
            url,
            ratePerSecond: Math.round((numRequests / duration) * 1000),
          },
          httpRequest: this.buildRequestString(endpoint.method, url, authHeaders),
          httpResponse: this.buildResponseString(
            results[0]?.status || 200,
            (results[0]?.headers as any) || {},
            null,
          ),
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
      } else if (!rateLimitHeadersPresent && rateLimited > 0) {
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
          description: `Rate limiting is enforced (received ${rateLimited} HTTP 429 responses), and none of them carried a rate-limit header (checked: ${RATE_LIMIT_HEADER_NAMES.join(', ')}). Without these headers, clients cannot implement backoff strategies.`,
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
