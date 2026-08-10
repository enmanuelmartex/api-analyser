import axios from 'axios';
import { BasePlugin, ScanContext, PluginResult, ScanFinding, ParsedEndpoint } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';
import { randomUUID } from 'node:crypto';
import { redactUrl } from '../../../../common/utils/redact.util';
import { wasProcessed } from '../shared/request-outcome';
import { isDistinctFromBaseline } from '../shared/baseline';
import {
  declaredSignatureHeader,
  detectUpstreamErrorLeak,
  extractExternalUrls,
  webhookIntakeTerm,
} from './upstream-signals';

/**
 * API10:2023 — Unsafe Consumption of APIs.
 *
 * The category concerns the trust a service places in the third parties it
 * talks to. Most of that conversation happens between the target and its
 * upstreams and is invisible from here, so this check does not pretend to
 * observe it. It reports the three things that do cross the boundary:
 *
 *   - an upstream URL returned over plain HTTP, which is data in transit that
 *     an attacker on the path can rewrite before the service or its clients
 *     consume it;
 *   - an upstream failure relayed to the caller verbatim, which proves output
 *     from a third party reaches the client without being normalised;
 *   - an inbound webhook that accepts a third party's data without any means of
 *     verifying the sender.
 *
 * What it cannot see, stated so nobody reads a clean result as more than it is:
 * whether the service validates the *content* of an upstream response, whether
 * it follows redirects into untrusted hosts, and any integration that neither
 * appears in a response nor has an intake endpoint in the specification. Those
 * need code or egress analysis.
 */
export class ApiConsumptionPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'api-consumption',
    name: 'Third-Party API Consumption',
    version: '1.0.0',
    description: 'Tests for API10:2023 - Unsafe Consumption of APIs',
    longDescription:
      'Inspects responses for references to upstream services the API depends on, flagging any reached over plain HTTP and any upstream error relayed to the caller verbatim. Also probes inbound webhook and callback endpoints for sender verification. Limited to what crosses the client boundary — it cannot observe the traffic the target sends to its own upstreams.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.INFRASTRUCTURE,
    owaspMappings: ['API10:2023'],
    cweIds: ['CWE-319', 'CWE-345', 'CWE-209', 'CWE-1385'],
    tags: ['third-party', 'integrations', 'webhooks', 'supply-chain', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'http:write', 'findings:write'],
    configFields: [
      {
        key: 'maxEndpoints',
        label: 'Endpoints inspected',
        description: 'How many read endpoints to inspect for upstream references.',
        type: 'number',
        default: 6,
        min: 1,
        max: 20,
      },
    ],
    defaultConfig: { maxEndpoints: 6 },
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'consumption',
    ruleIds: [
      'consumption.insecure-upstream-url',
      'consumption.upstream-error-passthrough',
      'consumption.unauthenticated-webhook-intake',
    ],
  };

  async run(context: ScanContext, pluginConfig: Record<string, any> = {}): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const maxEndpoints = this.clamp(pluginConfig.maxEndpoints ?? 6, 1, 20);
    const authHeaders = this.getAuthHeaders(context.auth);
    const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });

    const targetHost = this.hostOf(context.baseUrl);
    if (!targetHost) return this.result(findings, start, tested);

    /** Hosts already reported, so one integration produces one finding. */
    const reportedInsecureHosts = new Set<string>();
    const reportedLeakProviders = new Set<string>();

    /*
     * What this target returns for a route that does not exist. A host that
     * answers everything identically — a single-page app, a catch-all gateway,
     * a base URL naming the wrong service — would otherwise have its own markup
     * mined for upstream references and reported as this API's dependencies.
     */
    const readBaseline = await this.send('GET', this.nonexistentUrl(context.baseUrl), authHeaders);

    // ── Pass 1: what do responses say about the API's own dependencies? ───────
    const readEndpoints = context.endpoints
      .filter((endpoint) => endpoint.method.toUpperCase() === 'GET')
      .slice(0, maxEndpoints);

    for (const endpoint of readEndpoints) {
      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      const response = await this.send('GET', url, authHeaders);
      tested++;

      if (!response) continue;
      if (readBaseline && !isDistinctFromBaseline(response, readBaseline)) continue;

      // Upstream references handed to the client.
      for (const reference of extractExternalUrls(response.body, targetHost)) {
        if (!reference.insecure) continue;
        if (reportedInsecureHosts.has(reference.host)) continue;
        reportedInsecureHosts.add(reference.host);

        const named = reference.provider ?? reference.host;

        findings.push({
          title: `Upstream dependency referenced over plain HTTP (${named})`,
          category: 'Third-Party Consumption',
          severity: 'MEDIUM',
          cvssScore: 6.5,
          owaspCategory: 'API10:2023',
          cweId: 'CWE-319',
          ruleId: 'consumption.insecure-upstream-url',
          component: 'response-body:upstream-url',
          route: endpoint.path,
          method: endpoint.method,
          pluginId: this.id,
          endpointId: endpoint.id,
          affectedUrl: `${endpoint.method} ${url}`,
          description:
            `The response from ${endpoint.method} ${endpoint.path} contains an absolute URL to the third-party host ` +
            `"${reference.host}" over plain HTTP: ${redactUrl(reference.url)}. Whatever fetches that URL — this ` +
            `service on a later call, or every client that received the response — retrieves it over a channel ` +
            `anyone on the network path can read and rewrite.`,
          impact:
            `Content served from ${named} over HTTP is attacker-controllable in transit. Where the value is data ` +
            `the service later consumes, an attacker on the path chooses what it consumes; where it is a script, ` +
            `an image or a document handed to clients, they choose what those clients load. Neither case leaves a ` +
            `trace in the target's own logs.`,
          likelihood: 'MEDIUM',
          riskScore: 6.5,
          evidence: {
            upstreamHost: reference.host,
            provider: reference.provider,
            scheme: 'http',
            referenceUrl: redactUrl(reference.url),
            observedOn: `${endpoint.method} ${endpoint.path}`,
          },
          httpRequest: this.buildRequestString('GET', url, authHeaders),
          httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
          remediation: `Reach every upstream over TLS and refuse to fall back:

1. Replace the \`http://\` reference with \`https://\` at the source that generates it — rewriting it at the edge leaves the original call unencrypted.
2. Reject plain-HTTP upstream URLs in configuration validation at start-up, so a mistyped environment variable fails the deploy instead of the transport.
3. Verify certificates on outbound calls; a client with verification disabled is not meaningfully better than HTTP.
4. Treat everything an upstream returns as untrusted input regardless of transport — validate it against a schema before it reaches business logic.`,
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
            'https://cwe.mitre.org/data/definitions/319.html',
          ],
        });
      }

      // Upstream failures relayed verbatim.
      const leak = detectUpstreamErrorLeak(response.body, targetHost);
      if (leak && !reportedLeakProviders.has(leak.provider) && response.status >= 400) {
        reportedLeakProviders.add(leak.provider);

        findings.push({
          title: `Upstream error from ${leak.provider} is relayed to the caller`,
          category: 'Third-Party Consumption',
          severity: 'MEDIUM',
          cvssScore: 5.3,
          owaspCategory: 'API10:2023',
          cweId: 'CWE-209',
          ruleId: 'consumption.upstream-error-passthrough',
          component: 'response-body:upstream-error',
          route: endpoint.path,
          method: endpoint.method,
          pluginId: this.id,
          endpointId: endpoint.id,
          affectedUrl: `${endpoint.method} ${url}`,
          description:
            `${endpoint.method} ${endpoint.path} returned HTTP ${response.status} carrying an error that came from ` +
            `an upstream dependency rather than from this API: the body names ${leak.provider} alongside ` +
            `"${leak.errorToken}". Output from a third party is therefore reaching the client without being ` +
            `normalised, which is the same trust boundary the category is about — data crossing from an upstream ` +
            `into the response unchecked.`,
          impact:
            `Two consequences. The response discloses the integration, and frequently its endpoint, client library ` +
            `and stack frames — a map of the service's dependencies for an attacker to work against. And an ` +
            `upstream that can shape the bytes a client receives can shape them deliberately once it is ` +
            `compromised or impersonated.`,
          likelihood: 'MEDIUM',
          riskScore: 5.3,
          evidence: {
            provider: leak.provider,
            upstreamHost: leak.host,
            errorToken: leak.errorToken,
            status: response.status,
            bodyPreview: response.body.slice(0, 200),
          },
          httpRequest: this.buildRequestString('GET', url, authHeaders),
          httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
          remediation:
            'Catch upstream failures at the integration boundary and translate them into this API\'s own error ' +
            'contract: a stable code, no upstream identifiers, no stack. Log the original with a correlation id so ' +
            'support keeps what it needs. Validate every upstream response against a schema before it is used, and ' +
            'apply a timeout and a circuit breaker so a failing dependency degrades this API instead of shaping it.',
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
            'https://cwe.mitre.org/data/definitions/209.html',
          ],
        });
      }

      await this.delay(context.config.requestDelayMs);
    }

    // ── Pass 2: inbound intake — who is allowed to call the webhook? ──────────
    const intakes = context.endpoints
      .filter((endpoint) => ['POST', 'PUT'].includes(endpoint.method.toUpperCase()))
      .map((endpoint) => ({ endpoint, term: webhookIntakeTerm(endpoint.path, endpoint.summary) }))
      .filter((candidate): candidate is { endpoint: ParsedEndpoint; term: string } => candidate.term !== null)
      .slice(0, 3);

    for (const { endpoint, term } of intakes) {
      const signatureHeader = declaredSignatureHeader(
        (endpoint.parameters ?? [])
          .filter((parameter: any) => parameter.in === 'header')
          .map((parameter: any) => String(parameter.name ?? '')),
      );

      // A declared signature header means the sender is verified somehow. Whether
      // the verification is correct is not decidable from outside, and guessing
      // would produce a finding the team cannot act on.
      if (signatureHeader) continue;

      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      const body = { [appBrand.scannerProbeField]: context.assessmentId };
      const probeHeaders = {
        ...anonymousHeaders,
        'Content-Type': 'application/json',
        [appBrand.scannerProbeHeader]: 'webhook-intake',
      };

      // Same baseline discipline as the read pass: an intake that answers like a
      // route which does not exist has not accepted anything.
      const intakeBaseline = await this.send(
        endpoint.method,
        this.nonexistentUrl(context.baseUrl),
        probeHeaders,
        body,
      );
      const response = await this.send(endpoint.method, url, probeHeaders, body);
      tested++;

      if (!response || !wasProcessed(response.status)) continue;
      if (intakeBaseline && !isDistinctFromBaseline(response, intakeBaseline)) continue;

      findings.push({
        title: 'Webhook intake accepts unverified third-party data',
        category: 'Third-Party Consumption',
        severity: 'HIGH',
        cvssScore: 7.5,
        owaspCategory: 'API10:2023',
        cweId: 'CWE-345',
        ruleId: 'consumption.unauthenticated-webhook-intake',
        component: 'endpoint',
        route: endpoint.path,
        method: endpoint.method,
        pluginId: this.id,
        endpointId: endpoint.id,
        affectedUrl: `${endpoint.method} ${url}`,
        description:
          `${endpoint.method} ${endpoint.path} is an intake endpoint — identified by the term "${term}" in its ` +
          `definition — that exists to receive calls from a third party. It declares no signature header ` +
          `(\`X-Hub-Signature\`, \`Stripe-Signature\` or equivalent), and a request carrying no credentials and no ` +
          `signature was processed by the application: HTTP ${response.status}. Anyone who can reach this URL can ` +
          `therefore submit data that the service will treat as coming from the provider.`,
        impact:
          'A webhook payload usually drives a state change that is trusted precisely because of where it came ' +
          'from: a payment marked settled, a subscription activated, an account upgraded, a job accepted. Without ' +
          'sender verification an attacker asserts those events directly, and the resulting records look ' +
          'legitimate in every downstream system.',
        likelihood: 'HIGH',
        riskScore: 7.5,
        evidence: {
          intakeTerm: term,
          declaredHeaderParameters: (endpoint.parameters ?? [])
            .filter((parameter: any) => parameter.in === 'header')
            .map((parameter: any) => parameter.name),
          signatureHeaderDeclared: false,
          statusWithoutCredentials: response.status,
          responsePreview: response.body.slice(0, 200),
        },
        httpRequest: this.buildRequestString(endpoint.method, url, anonymousHeaders, body),
        httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
        remediation: `Verify the sender before the payload reaches any business logic:

1. Validate the provider's signature header over the **raw** request body with a shared secret, before parsing. Parsing first and re-serialising changes the bytes and breaks the comparison.
2. Compare digests in constant time, and reject a request whose signature header is absent — not only one whose signature is wrong.
3. Enforce the timestamp the provider signs, with a short tolerance window, so a captured call cannot be replayed later.
4. Where the provider supports it, prefer mutual TLS or an allowlist of source addresses in addition to the signature.
5. Treat the payload as a notification rather than as truth: re-read the affected object from the provider's API before acting on it.`,
        references: [
          'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
          'https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html',
          'https://cwe.mitre.org/data/definitions/345.html',
        ],
      });

      await this.delay(context.config.requestDelayMs);
    }

    return this.result(findings, start, tested);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** A URL on the target that certainly does not resolve to a real route. */
  private nonexistentUrl(baseUrl: string): string {
    return this.buildUrl(baseUrl, `${appBrand.fileSlug}-probe-${randomUUID().slice(0, 12)}`);
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; body: string; bodyLength: number } | null> {
    try {
      const response = await axios.request({
        method: method as any,
        url,
        headers,
        data: body,
        timeout: 5000,
        maxRedirects: 0,
        validateStatus: () => true,
        transformResponse: [(data) => data],
        responseType: 'text',
      });

      const text = typeof response.data === 'string' ? response.data : String(response.data ?? '');

      return {
        status: response.status,
        headers: this.lowercaseKeys(response.headers as any),
        body: text.slice(0, 8000),
        bodyLength: text.length,
      };
    } catch {
      return null;
    }
  }

  private hostOf(baseUrl: string): string | null {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return null;
    }
  }

  private lowercaseKeys(headers: Record<string, any>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
  }

  private clamp(value: any, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  private result(findings: ScanFinding[], start: number, tested: number): PluginResult {
    return {
      pluginId: this.id,
      pluginName: this.name,
      findings,
      scanDuration: Date.now() - start,
      endpointsTested: tested,
    };
  }
}
