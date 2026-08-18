import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { BasePlugin, ScanContext, PluginResult, ScanFinding, ParsedEndpoint } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';
import { wasProcessed } from '../shared/request-outcome';
import { isDistinctFromBaseline } from '../shared/baseline';
import {
  classifyBusinessFlow,
  flowKindLabel,
  isHighImpactFlow,
  isPublicByDesignAccountFlow,
  type BusinessFlowMatch,
} from './business-flow-classifier';

/**
 * API6:2023 — Unrestricted Access to Sensitive Business Flows.
 *
 * The category asks a question no single request can answer: can this flow be
 * automated to the detriment of the business? What this check can establish is
 * the precondition — that a flow with business consequences is reachable and
 * has no control in front of it that would slow an automated caller down.
 *
 * Scope, stated plainly because a security check that overstates itself is
 * worse than no check:
 *
 *   - Flows are identified from the specification's own naming (see
 *     `business-flow-classifier.ts`). A flow named in terms the vocabulary does
 *     not recognise is not examined, and every finding names the term that
 *     matched so the classification can be judged.
 *   - "No anti-automation control" means: no 429, no rate-limit headers, no bot
 *     mitigation headers, and no captcha/OTP field declared on the operation.
 *     A control that exists but only triggers above the probe volume will read
 *     as absent, so the burst size is configurable.
 *   - Probes are sent with a payload the target is expected to reject, so the
 *     flow itself is not executed. Anti-automation controls sit in front of
 *     business validation in every stack this could run against, which is why
 *     an invalid payload still proves their absence.
 *   - Nothing is reported unless the flow's route answers differently from a
 *     route that does not exist. A base URL pointing at a static site or a
 *     catch-all gateway accepts every probe, and without that comparison this
 *     check would report a HIGH on a payment flow that was never deployed.
 */
export class BusinessFlowsPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'business-flows',
    name: 'Sensitive Business Flows',
    version: '1.0.0',
    description: 'Tests for API6:2023 - Unrestricted Access to Sensitive Business Flows',
    longDescription:
      'Identifies state-changing endpoints that carry business consequences — payment, ordering, booking, promotion, messaging, account and content-submission flows — from the naming in the specification, then probes each one for the controls that would stop an automated caller: throttling, bot mitigation, captcha/OTP challenges, authentication and idempotency keys. Probes carry a payload the target is expected to reject, so the flow is not executed; DELETE operations are never probed.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.API_DESIGN,
    owaspMappings: ['API6:2023'],
    cweIds: ['CWE-799', 'CWE-837', 'CWE-770'],
    tags: ['business-logic', 'anti-automation', 'abuse', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'http:write', 'findings:write'],
    configFields: [
      {
        key: 'burstRequests',
        label: 'Requests per flow',
        description:
          'How many rapid requests to send at each flow. A control that only triggers above this volume will look absent.',
        type: 'number',
        default: 8,
        min: 3,
        max: 20,
      },
      {
        key: 'maxFlows',
        label: 'Maximum flows probed',
        description: 'Caps how many sensitive flows are examined in one scan.',
        type: 'number',
        default: 4,
        min: 1,
        max: 15,
      },
    ],
    defaultConfig: { burstRequests: 8, maxFlows: 4 },
    minimumCoreVersion: '1.0.0',
    isBuiltin: true,
    ruleNamespace: 'business-flow',
    ruleIds: [
      'business-flow.no-anti-automation',
      'business-flow.unauthenticated-access',
      'business-flow.missing-idempotency-control',
    ],
  };

  /**
   * Request fields that indicate the flow already challenges automated callers.
   * Their presence suppresses the anti-automation finding.
   */
  private readonly challengeFields = [
    'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'challenge', 'otp',
    'onetimecode', 'one_time_code', 'totp', 'mfa', 'proofofwork', 'nonce',
  ];

  /** Response headers that prove throttling or bot mitigation is in place. */
  private readonly antiAutomationHeaders = [
    'x-ratelimit-limit', 'ratelimit-limit', 'x-rate-limit-limit',
    'x-ratelimit-remaining', 'ratelimit-remaining', 'retry-after',
    'cf-mitigated', 'cf-ray', 'x-datadome', 'x-px-block', 'x-akamai-bot',
    'x-recaptcha-action', 'x-queue-token',
  ];

  /** Header parameters that let a client make a repeated call harmless. */
  private readonly idempotencyHeaders = [
    'idempotency-key', 'x-idempotency-key', 'idempotency-token',
    'x-request-id', 'request-id', 'x-transaction-id',
  ];

  async run(context: ScanContext, pluginConfig: Record<string, any> = {}): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];

    const burstRequests = this.clamp(pluginConfig.burstRequests ?? 8, 3, 20);
    const maxFlows = this.clamp(pluginConfig.maxFlows ?? 4, 1, 15);

    const authHeaders = this.getAuthHeaders(context.auth);
    const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });

    const flows = context.endpoints
      .map((endpoint) => ({ endpoint, flow: classifyBusinessFlow(endpoint) }))
      .filter((candidate): candidate is { endpoint: ParsedEndpoint; flow: BusinessFlowMatch } =>
        candidate.flow !== null,
      )
      .slice(0, maxFlows);

    /** Baselines by `${method}:${authenticated}`, fetched once and reused. */
    const baselines = new Map<string, { status: number; bodyLength: number } | null>();

    for (const { endpoint, flow } of flows) {
      const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
      const body = this.probeBody(context.assessmentId);
      const headers = { ...authHeaders, 'Content-Type': 'application/json', [appBrand.scannerProbeHeader]: 'business-flow' };

      /*
       * How does this target answer a route that is not there? Everything below
       * is a comparison against that, so a host that accepts every request —
       * a single-page app, a catch-all gateway, the wrong base URL — yields
       * nothing rather than a page of critical findings about routes that do
       * not exist.
       */
      const baseline = await this.baselineFor(baselines, context, endpoint.method, 'auth', headers, body);
      if (!baseline) continue;

      // ── Burst: is there anything in front of this flow? ────────────────────
      const burstStart = Date.now();
      const results = await Promise.all(
        Array.from({ length: burstRequests }, () =>
          this.send(endpoint.method, url, headers, body),
        ),
      );
      const durationMs = Date.now() - burstStart;

      const statuses = results.map((r) => r.status);
      const processed = statuses.filter(wasProcessed).length;
      const throttled = statuses.filter((s) => s === 429).length;
      const observedHeaders = Object.assign({}, ...results.map((r) => r.headers ?? {}));
      const throttleHeader = this.antiAutomationHeaders.find((name) => observedHeaders[name]);
      const declaredChallenge = this.declaredChallengeField(endpoint);

      /*
       * Only a flow that actually processed the burst can support a claim about
       * its controls. If the requests were refused at the edge — auth, WAF, an
       * absent route — the check learned that the flow is protected or that it
       * could not be reached, and reporting either as "unrestricted" would be
       * an invented finding. The route must also answer differently from one
       * that does not exist, or "processed" means nothing.
       */
      const routed = results.some((result) =>
        isDistinctFromBaseline({ status: result.status, bodyLength: result.bodyLength }, baseline),
      );
      const burstLanded = routed && processed >= Math.ceil(burstRequests * 0.8);

      if (burstLanded && throttled === 0 && !throttleHeader && !declaredChallenge) {
        const highImpact = isHighImpactFlow(flow.kind);
        findings.push({
          title: `Sensitive ${flowKindLabel(flow.kind)} flow has no anti-automation control`,
          category: 'Business Logic',
          severity: highImpact ? 'HIGH' : 'MEDIUM',
          cvssScore: highImpact ? 7.5 : 5.3,
          owaspCategory: 'API6:2023',
          cweId: 'CWE-799',
          ruleId: 'business-flow.no-anti-automation',
          component: 'endpoint',
          route: endpoint.path,
          method: endpoint.method,
          pluginId: this.id,
          endpointId: endpoint.id,
          affectedUrl: `${endpoint.method} ${url}`,
          description:
            `${endpoint.method} ${endpoint.path} is a ${flowKindLabel(flow.kind)} flow — classified from the ` +
            `term "${flow.term}" in its ${flow.matchedIn}. ${burstRequests} requests sent in ${durationMs}ms were ` +
            `all processed by the application (${processed} reached business validation, none rejected with HTTP 429). ` +
            `No rate-limit or bot-mitigation headers were returned, and the operation declares no captcha, OTP or ` +
            `other challenge field. Nothing observed would slow a caller repeating this flow at machine speed. ` +
            `Probes carried a payload the API is expected to reject, so the flow itself was not executed — the ` +
            `finding is the absence of the control, not the outcome of the flow.`,
          impact:
            `A ${flowKindLabel(flow.kind)} flow that can be repeated without limit is abused for its business ` +
            `effect rather than for data: inventory reserved and never bought, promotions drained, messages or ` +
            `notifications sent at the target's expense, or accounts and content created in bulk. The requests are ` +
            `individually valid, so nothing in the application logs looks like an attack.`,
          likelihood: highImpact ? 'HIGH' : 'MEDIUM',
          riskScore: highImpact ? 7.5 : 5.3,
          evidence: {
            flowKind: flow.kind,
            classifiedBy: `${flow.matchedIn}:${flow.term}`,
            requestsSent: burstRequests,
            processedResponses: processed,
            rateLimitedResponses: throttled,
            statusCodes: this.countStatuses(statuses),
            durationMs,
            ratePerSecond: durationMs > 0 ? Math.round((burstRequests / durationMs) * 1000) : null,
            antiAutomationHeaderFound: false,
            challengeFieldDeclared: false,
          },
          httpRequest: this.buildRequestString(endpoint.method, url, headers, body),
          httpResponse: this.buildResponseString(
            statuses[0] ?? 0,
            (results[0]?.headers as any) ?? {},
            results[0]?.bodyPreview ?? null,
          ),
          remediation: `Put a control in front of this flow, sized to the business action rather than to the endpoint:

1. Rate-limit per authenticated principal and per payment instrument or device, not only per IP — a bulk abuser rotates addresses.
2. Require an idempotency key on flows that move money or reserve inventory, and return the first result for a repeated key.
3. Add a challenge (captcha, OTP, step-up authentication) once a caller exceeds normal usage for the flow, not on every request.
4. Enforce business quotas: orders per customer per hour, invitations per account, promotion redemptions per identity.
5. Alert on flow-completion rate, not just request rate — automation shows up as an unusual ratio between starts and completions.

Example (NestJS, per-principal throttling on a checkout flow):
\`\`\`typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('checkout')
async checkout(@Req() req, @Headers('idempotency-key') key: string) {
  if (!key) throw new BadRequestException('Idempotency-Key header is required');
  return this.orders.checkout(req.user.id, key);
}
\`\`\``,
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
            'https://owasp.org/www-project-automated-threats-to-web-applications/',
            'https://cwe.mitre.org/data/definitions/799.html',
          ],
        });
      }

      // ── Does the flow require authentication at all? ───────────────────────
      //
      // Skipped for account-creation flows (register/signup): a caller cannot
      // already hold a session for an account that does not exist yet, so
      // "accepts unauthenticated requests" is not a finding there, it is the
      // feature. This does not extend to the rest of ACCOUNT — a `password`
      // match may well be an authenticated "change my password" endpoint,
      // where the same probe finding unauthenticated access is a real
      // account-takeover bug and must still be reported.
      const anonymousProbeHeaders = {
        ...anonymousHeaders,
        'Content-Type': 'application/json',
        [appBrand.scannerProbeHeader]: 'business-flow',
      };
      const anonymousBaseline = await this.baselineFor(
        baselines,
        context,
        endpoint.method,
        'anon',
        anonymousProbeHeaders,
        body,
      );
      const anonymous = await this.send(endpoint.method, url, anonymousProbeHeaders, body);

      if (
        !isPublicByDesignAccountFlow(flow) &&
        anonymousBaseline &&
        wasProcessed(anonymous.status) &&
        isDistinctFromBaseline(
          { status: anonymous.status, bodyLength: anonymous.bodyLength },
          anonymousBaseline,
        )
      ) {
        const declaresSecurity = Array.isArray(endpoint.security) && endpoint.security.length > 0;

        findings.push({
          title: `Sensitive ${flowKindLabel(flow.kind)} flow accepts unauthenticated requests`,
          category: 'Business Logic',
          severity: declaresSecurity ? 'HIGH' : 'MEDIUM',
          cvssScore: declaresSecurity ? 8.2 : 5.8,
          owaspCategory: 'API6:2023',
          cweId: 'CWE-837',
          ruleId: 'business-flow.unauthenticated-access',
          component: 'endpoint',
          route: endpoint.path,
          method: endpoint.method,
          pluginId: this.id,
          endpointId: endpoint.id,
          affectedUrl: `${endpoint.method} ${url}`,
          description:
            `${endpoint.method} ${endpoint.path} is a ${flowKindLabel(flow.kind)} flow that returned HTTP ` +
            `${anonymous.status} to a request carrying no credentials — the application processed the call rather ` +
            `than challenging it. ` +
            (declaresSecurity
              ? `The specification declares a security requirement for this operation, so the deployed behaviour ` +
                `contradicts the contract: what is documented as protected is not.`
              : `The specification declares no security requirement for this operation, so the flow is intended to ` +
                `be public; without an identity to attribute calls to, per-user quotas cannot exist.`),
          impact:
            `An anonymous caller can drive the flow, so abuse cannot be attributed, rate-limited per account, or ` +
            `stopped by disabling a user. For a ${flowKindLabel(flow.kind)} flow this turns every quota into an ` +
            `IP-based one, which an attacker defeats with a proxy pool.`,
          likelihood: 'HIGH',
          riskScore: declaresSecurity ? 8.2 : 5.8,
          evidence: {
            flowKind: flow.kind,
            classifiedBy: `${flow.matchedIn}:${flow.term}`,
            statusWithoutCredentials: anonymous.status,
            declaredSecurityRequirement: declaresSecurity,
            responsePreview: anonymous.bodyPreview?.slice(0, 200) ?? null,
          },
          httpRequest: this.buildRequestString(endpoint.method, url, anonymousHeaders, body),
          httpResponse: this.buildResponseString(
            anonymous.status,
            (anonymous.headers as any) ?? {},
            anonymous.bodyPreview,
          ),
          remediation: declaresSecurity
            ? 'Enforce the security scheme the specification declares for this operation. A documented requirement that the runtime does not apply is worse than no requirement, because reviewers stop looking.'
            : 'If the flow must stay public, bind it to something an attacker cannot mint freely — a verified email or phone, a signed session issued after a challenge, or a payment instrument — and apply quotas to that identity rather than to the request.',
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
            'https://cwe.mitre.org/data/definitions/837.html',
          ],
        });
      }

      // ── Can a repeated call be made harmless? ──────────────────────────────
      const needsIdempotency = ['PAYMENT', 'ORDER', 'BOOKING'].includes(flow.kind);
      const declaredIdempotency = this.declaredIdempotencyHeader(endpoint);
      const echoedIdempotency = this.idempotencyHeaders.find((name) => observedHeaders[name]);

      if (
        needsIdempotency &&
        endpoint.method.toUpperCase() === 'POST' &&
        burstLanded &&
        !declaredIdempotency &&
        !echoedIdempotency
      ) {
        findings.push({
          title: `${this.capitalise(flowKindLabel(flow.kind))} flow offers no idempotency control`,
          category: 'Business Logic',
          severity: 'LOW',
          cvssScore: 3.7,
          owaspCategory: 'API6:2023',
          cweId: 'CWE-837',
          ruleId: 'business-flow.missing-idempotency-control',
          component: 'request-header:idempotency-key',
          route: endpoint.path,
          method: endpoint.method,
          pluginId: this.id,
          endpointId: endpoint.id,
          affectedUrl: `${endpoint.method} ${url}`,
          description:
            `${endpoint.method} ${endpoint.path} is a ${flowKindLabel(flow.kind)} flow. It declares no idempotency ` +
            `key header in its specification, and no such header was returned across ${burstRequests} probe ` +
            `responses. A client — or an attacker replaying a captured request — has no way to tell the API that ` +
            `two identical calls are the same business action.`,
          impact:
            'A retried or replayed request creates a second charge, order or reservation. This is also what makes ' +
            'volume abuse of the flow cheap: every repetition produces a new business object.',
          likelihood: 'MEDIUM',
          riskScore: 3.7,
          evidence: {
            flowKind: flow.kind,
            declaredHeaderParameters: (endpoint.parameters ?? [])
              .filter((p: any) => p.in === 'header')
              .map((p: any) => p.name),
            idempotencyHeaderInResponses: false,
            probeResponses: burstRequests,
          },
          remediation:
            'Accept an `Idempotency-Key` request header on this flow, store the first response against that key for a bounded window, and return it verbatim for any repeat. Document the header in the specification so clients use it.',
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
            'https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/',
          ],
        });
      }

      await this.delay(context.config.requestDelayMs);
    }

    return {
      pluginId: this.id,
      pluginName: this.name,
      findings,
      scanDuration: Date.now() - start,
      endpointsTested: flows.length,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * A payload the target is expected to reject.
   *
   * The marker carries the assessment id so an operator reading their own logs
   * can attribute the traffic to a specific scan rather than to an attack.
   */
  private probeBody(assessmentId: string): Record<string, string> {
    return { [appBrand.scannerProbeField]: assessmentId };
  }

  /**
   * The target's answer to a route that does not exist, for one method and one
   * set of headers.
   *
   * Cached across flows: the answer does not change between two nonexistent
   * paths, and re-asking would multiply the mutating traffic this check sends.
   * `null` means the baseline request failed, in which case there is nothing to
   * compare against and the flow is left alone.
   */
  private async baselineFor(
    cache: Map<string, { status: number; bodyLength: number } | null>,
    context: ScanContext,
    method: string,
    /*
     * Passed explicitly rather than sniffed from the headers: credentials reach
     * a target as `Authorization`, `X-API-Key` or an arbitrary custom header
     * depending on the auth config, and a cache key that only recognises the
     * first would hand the authenticated probe the anonymous baseline.
     */
    mode: 'auth' | 'anon',
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ status: number; bodyLength: number } | null> {
    const key = `${method.toUpperCase()}:${mode}`;
    if (cache.has(key)) return cache.get(key)!;

    const url = this.buildUrl(context.baseUrl, `${appBrand.fileSlug}-probe-${randomUUID().slice(0, 12)}`);
    const response = await this.send(method, url, headers, body);
    const baseline = response.status > 0
      ? { status: response.status, bodyLength: response.bodyLength }
      : null;

    cache.set(key, baseline);
    return baseline;
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; bodyLength: number; bodyPreview: string | null }> {
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
        bodyLength: text.length,
        bodyPreview: text.slice(0, 300),
      };
    } catch {
      return { status: 0, headers: {}, bodyLength: 0, bodyPreview: null };
    }
  }

  /** Name of a captcha/OTP-style field the operation declares, if any. */
  private declaredChallengeField(endpoint: ParsedEndpoint): string | null {
    const names = [
      ...(endpoint.parameters ?? []).map((p: any) => p.name ?? ''),
      ...Object.keys(
        endpoint.requestBody?.content?.['application/json']?.schema?.properties ?? {},
      ),
    ].map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));

    return (
      names.find((name) => this.challengeFields.some((field) => name.includes(field.replace(/[^a-z0-9]/g, '')))) ??
      null
    );
  }

  /** Name of an idempotency header the operation declares, if any. */
  private declaredIdempotencyHeader(endpoint: ParsedEndpoint): string | null {
    const headerParams = (endpoint.parameters ?? [])
      .filter((p: any) => p.in === 'header')
      .map((p: any) => String(p.name ?? '').toLowerCase());

    return headerParams.find((name) => this.idempotencyHeaders.includes(name)) ?? null;
  }

  private countStatuses(statuses: number[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const key = status === 0 ? 'network-error' : String(status);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
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

  private capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
