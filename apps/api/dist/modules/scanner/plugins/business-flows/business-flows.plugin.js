"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessFlowsPlugin = void 0;
const axios_1 = require("axios");
const node_crypto_1 = require("node:crypto");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
const request_outcome_1 = require("../shared/request-outcome");
const baseline_1 = require("../shared/baseline");
const business_flow_classifier_1 = require("./business-flow-classifier");
class BusinessFlowsPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'business-flows',
            name: 'Sensitive Business Flows',
            version: '1.0.0',
            description: 'Tests for API6:2023 - Unrestricted Access to Sensitive Business Flows',
            longDescription: 'Identifies state-changing endpoints that carry business consequences — payment, ordering, booking, promotion, messaging, account and content-submission flows — from the naming in the specification, then probes each one for the controls that would stop an automated caller: throttling, bot mitigation, captcha/OTP challenges, authentication and idempotency keys. Probes carry a payload the target is expected to reject, so the flow is not executed; DELETE operations are never probed.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.API_DESIGN,
            owaspMappings: ['API6:2023'],
            cweIds: ['CWE-799', 'CWE-837', 'CWE-770'],
            tags: ['business-logic', 'anti-automation', 'abuse', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'http:write', 'findings:write'],
            configFields: [
                {
                    key: 'burstRequests',
                    label: 'Requests per flow',
                    description: 'How many rapid requests to send at each flow. A control that only triggers above this volume will look absent.',
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
        this.challengeFields = [
            'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'challenge', 'otp',
            'onetimecode', 'one_time_code', 'totp', 'mfa', 'proofofwork', 'nonce',
        ];
        this.antiAutomationHeaders = [
            'x-ratelimit-limit', 'ratelimit-limit', 'x-rate-limit-limit',
            'x-ratelimit-remaining', 'ratelimit-remaining', 'retry-after',
            'cf-mitigated', 'cf-ray', 'x-datadome', 'x-px-block', 'x-akamai-bot',
            'x-recaptcha-action', 'x-queue-token',
        ];
        this.idempotencyHeaders = [
            'idempotency-key', 'x-idempotency-key', 'idempotency-token',
            'x-request-id', 'request-id', 'x-transaction-id',
        ];
    }
    async run(context, pluginConfig = {}) {
        const start = Date.now();
        const findings = [];
        const burstRequests = this.clamp(pluginConfig.burstRequests ?? 8, 3, 20);
        const maxFlows = this.clamp(pluginConfig.maxFlows ?? 4, 1, 15);
        const authHeaders = this.getAuthHeaders(context.auth);
        const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });
        const flows = context.endpoints
            .map((endpoint) => ({ endpoint, flow: (0, business_flow_classifier_1.classifyBusinessFlow)(endpoint) }))
            .filter((candidate) => candidate.flow !== null)
            .slice(0, maxFlows);
        const baselines = new Map();
        for (const { endpoint, flow } of flows) {
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            const body = this.probeBody(context.assessmentId);
            const headers = { ...authHeaders, 'Content-Type': 'application/json', [brand_1.appBrand.scannerProbeHeader]: 'business-flow' };
            const baseline = await this.baselineFor(baselines, context, endpoint.method, 'auth', headers, body);
            if (!baseline)
                continue;
            const burstStart = Date.now();
            const results = await Promise.all(Array.from({ length: burstRequests }, () => this.send(endpoint.method, url, headers, body)));
            const durationMs = Date.now() - burstStart;
            const statuses = results.map((r) => r.status);
            const processed = statuses.filter(request_outcome_1.wasProcessed).length;
            const throttled = statuses.filter((s) => s === 429).length;
            const observedHeaders = Object.assign({}, ...results.map((r) => r.headers ?? {}));
            const throttleHeader = this.antiAutomationHeaders.find((name) => observedHeaders[name]);
            const declaredChallenge = this.declaredChallengeField(endpoint);
            const routed = results.some((result) => (0, baseline_1.isDistinctFromBaseline)({ status: result.status, bodyLength: result.bodyLength }, baseline));
            const burstLanded = routed && processed >= Math.ceil(burstRequests * 0.8);
            if (burstLanded && throttled === 0 && !throttleHeader && !declaredChallenge) {
                const highImpact = (0, business_flow_classifier_1.isHighImpactFlow)(flow.kind);
                findings.push({
                    title: `Sensitive ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow has no anti-automation control`,
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
                    description: `${endpoint.method} ${endpoint.path} is a ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow — classified from the ` +
                        `term "${flow.term}" in its ${flow.matchedIn}. ${burstRequests} requests sent in ${durationMs}ms were ` +
                        `all processed by the application (${processed} reached business validation, none rejected with HTTP 429). ` +
                        `No rate-limit or bot-mitigation headers were returned, and the operation declares no captcha, OTP or ` +
                        `other challenge field. Nothing observed would slow a caller repeating this flow at machine speed. ` +
                        `Probes carried a payload the API is expected to reject, so the flow itself was not executed — the ` +
                        `finding is the absence of the control, not the outcome of the flow.`,
                    impact: `A ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow that can be repeated without limit is abused for its business ` +
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
                    httpResponse: this.buildResponseString(statuses[0] ?? 0, results[0]?.headers ?? {}, results[0]?.bodyPreview ?? null),
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
            const anonymousProbeHeaders = {
                ...anonymousHeaders,
                'Content-Type': 'application/json',
                [brand_1.appBrand.scannerProbeHeader]: 'business-flow',
            };
            const anonymousBaseline = await this.baselineFor(baselines, context, endpoint.method, 'anon', anonymousProbeHeaders, body);
            const anonymous = await this.send(endpoint.method, url, anonymousProbeHeaders, body);
            if (anonymousBaseline &&
                (0, request_outcome_1.wasProcessed)(anonymous.status) &&
                (0, baseline_1.isDistinctFromBaseline)({ status: anonymous.status, bodyLength: anonymous.bodyLength }, anonymousBaseline)) {
                const declaresSecurity = Array.isArray(endpoint.security) && endpoint.security.length > 0;
                findings.push({
                    title: `Sensitive ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow accepts unauthenticated requests`,
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
                    description: `${endpoint.method} ${endpoint.path} is a ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow that returned HTTP ` +
                        `${anonymous.status} to a request carrying no credentials — the application processed the call rather ` +
                        `than challenging it. ` +
                        (declaresSecurity
                            ? `The specification declares a security requirement for this operation, so the deployed behaviour ` +
                                `contradicts the contract: what is documented as protected is not.`
                            : `The specification declares no security requirement for this operation, so the flow is intended to ` +
                                `be public; without an identity to attribute calls to, per-user quotas cannot exist.`),
                    impact: `An anonymous caller can drive the flow, so abuse cannot be attributed, rate-limited per account, or ` +
                        `stopped by disabling a user. For a ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow this turns every quota into an ` +
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
                    httpResponse: this.buildResponseString(anonymous.status, anonymous.headers ?? {}, anonymous.bodyPreview),
                    remediation: declaresSecurity
                        ? 'Enforce the security scheme the specification declares for this operation. A documented requirement that the runtime does not apply is worse than no requirement, because reviewers stop looking.'
                        : 'If the flow must stay public, bind it to something an attacker cannot mint freely — a verified email or phone, a signed session issued after a challenge, or a payment instrument — and apply quotas to that identity rather than to the request.',
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
                        'https://cwe.mitre.org/data/definitions/837.html',
                    ],
                });
            }
            const needsIdempotency = ['PAYMENT', 'ORDER', 'BOOKING'].includes(flow.kind);
            const declaredIdempotency = this.declaredIdempotencyHeader(endpoint);
            const echoedIdempotency = this.idempotencyHeaders.find((name) => observedHeaders[name]);
            if (needsIdempotency &&
                endpoint.method.toUpperCase() === 'POST' &&
                burstLanded &&
                !declaredIdempotency &&
                !echoedIdempotency) {
                findings.push({
                    title: `${this.capitalise((0, business_flow_classifier_1.flowKindLabel)(flow.kind))} flow offers no idempotency control`,
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
                    description: `${endpoint.method} ${endpoint.path} is a ${(0, business_flow_classifier_1.flowKindLabel)(flow.kind)} flow. It declares no idempotency ` +
                        `key header in its specification, and no such header was returned across ${burstRequests} probe ` +
                        `responses. A client — or an attacker replaying a captured request — has no way to tell the API that ` +
                        `two identical calls are the same business action.`,
                    impact: 'A retried or replayed request creates a second charge, order or reservation. This is also what makes ' +
                        'volume abuse of the flow cheap: every repetition produces a new business object.',
                    likelihood: 'MEDIUM',
                    riskScore: 3.7,
                    evidence: {
                        flowKind: flow.kind,
                        declaredHeaderParameters: (endpoint.parameters ?? [])
                            .filter((p) => p.in === 'header')
                            .map((p) => p.name),
                        idempotencyHeaderInResponses: false,
                        probeResponses: burstRequests,
                    },
                    remediation: 'Accept an `Idempotency-Key` request header on this flow, store the first response against that key for a bounded window, and return it verbatim for any repeat. Document the header in the specification so clients use it.',
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
    probeBody(assessmentId) {
        return { [brand_1.appBrand.scannerProbeField]: assessmentId };
    }
    async baselineFor(cache, context, method, mode, headers, body) {
        const key = `${method.toUpperCase()}:${mode}`;
        if (cache.has(key))
            return cache.get(key);
        const url = this.buildUrl(context.baseUrl, `${brand_1.appBrand.fileSlug}-probe-${(0, node_crypto_1.randomUUID)().slice(0, 12)}`);
        const response = await this.send(method, url, headers, body);
        const baseline = response.status > 0
            ? { status: response.status, bodyLength: response.bodyLength }
            : null;
        cache.set(key, baseline);
        return baseline;
    }
    async send(method, url, headers, body) {
        try {
            const response = await axios_1.default.request({
                method: method,
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
                headers: this.lowercaseKeys(response.headers),
                bodyLength: text.length,
                bodyPreview: text.slice(0, 300),
            };
        }
        catch {
            return { status: 0, headers: {}, bodyLength: 0, bodyPreview: null };
        }
    }
    declaredChallengeField(endpoint) {
        const names = [
            ...(endpoint.parameters ?? []).map((p) => p.name ?? ''),
            ...Object.keys(endpoint.requestBody?.content?.['application/json']?.schema?.properties ?? {}),
        ].map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
        return (names.find((name) => this.challengeFields.some((field) => name.includes(field.replace(/[^a-z0-9]/g, '')))) ??
            null);
    }
    declaredIdempotencyHeader(endpoint) {
        const headerParams = (endpoint.parameters ?? [])
            .filter((p) => p.in === 'header')
            .map((p) => String(p.name ?? '').toLowerCase());
        return headerParams.find((name) => this.idempotencyHeaders.includes(name)) ?? null;
    }
    countStatuses(statuses) {
        const counts = {};
        for (const status of statuses) {
            const key = status === 0 ? 'network-error' : String(status);
            counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
    }
    lowercaseKeys(headers) {
        return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
    }
    clamp(value, min, max) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric))
            return min;
        return Math.min(max, Math.max(min, Math.round(numeric)));
    }
    capitalise(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
}
exports.BusinessFlowsPlugin = BusinessFlowsPlugin;
//# sourceMappingURL=business-flows.plugin.js.map