"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiConsumptionPlugin = void 0;
const axios_1 = require("axios");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
const node_crypto_1 = require("node:crypto");
const redact_util_1 = require("../../../../common/utils/redact.util");
const request_outcome_1 = require("../shared/request-outcome");
const baseline_1 = require("../shared/baseline");
const upstream_signals_1 = require("./upstream-signals");
class ApiConsumptionPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'api-consumption',
            name: 'Third-Party API Consumption',
            version: '1.0.0',
            description: 'Tests for API10:2023 - Unsafe Consumption of APIs',
            longDescription: 'Inspects responses for references to upstream services the API depends on, flagging any reached over plain HTTP and any upstream error relayed to the caller verbatim. Also probes inbound webhook and callback endpoints for sender verification. Limited to what crosses the client boundary — it cannot observe the traffic the target sends to its own upstreams.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.INFRASTRUCTURE,
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
    }
    async run(context, pluginConfig = {}) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const maxEndpoints = this.clamp(pluginConfig.maxEndpoints ?? 6, 1, 20);
        const authHeaders = this.getAuthHeaders(context.auth);
        const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });
        const targetHost = this.hostOf(context.baseUrl);
        if (!targetHost)
            return this.result(findings, start, tested);
        const reportedInsecureHosts = new Set();
        const reportedLeakProviders = new Set();
        const readBaseline = await this.send('GET', this.nonexistentUrl(context.baseUrl), authHeaders);
        const readEndpoints = context.endpoints
            .filter((endpoint) => endpoint.method.toUpperCase() === 'GET')
            .slice(0, maxEndpoints);
        for (const endpoint of readEndpoints) {
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            const response = await this.send('GET', url, authHeaders);
            tested++;
            if (!response)
                continue;
            if (readBaseline && !(0, baseline_1.isDistinctFromBaseline)(response, readBaseline))
                continue;
            for (const reference of (0, upstream_signals_1.extractExternalUrls)(response.body, targetHost)) {
                if (!reference.insecure)
                    continue;
                if (reportedInsecureHosts.has(reference.host))
                    continue;
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
                    description: `The response from ${endpoint.method} ${endpoint.path} contains an absolute URL to the third-party host ` +
                        `"${reference.host}" over plain HTTP: ${(0, redact_util_1.redactUrl)(reference.url)}. Whatever fetches that URL — this ` +
                        `service on a later call, or every client that received the response — retrieves it over a channel ` +
                        `anyone on the network path can read and rewrite.`,
                    impact: `Content served from ${named} over HTTP is attacker-controllable in transit. Where the value is data ` +
                        `the service later consumes, an attacker on the path chooses what it consumes; where it is a script, ` +
                        `an image or a document handed to clients, they choose what those clients load. Neither case leaves a ` +
                        `trace in the target's own logs.`,
                    likelihood: 'MEDIUM',
                    riskScore: 6.5,
                    evidence: {
                        upstreamHost: reference.host,
                        provider: reference.provider,
                        scheme: 'http',
                        referenceUrl: (0, redact_util_1.redactUrl)(reference.url),
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
            const leak = (0, upstream_signals_1.detectUpstreamErrorLeak)(response.body, targetHost);
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
                    description: `${endpoint.method} ${endpoint.path} returned HTTP ${response.status} carrying an error that came from ` +
                        `an upstream dependency rather than from this API: the body names ${leak.provider} alongside ` +
                        `"${leak.errorToken}". Output from a third party is therefore reaching the client without being ` +
                        `normalised, which is the same trust boundary the category is about — data crossing from an upstream ` +
                        `into the response unchecked.`,
                    impact: `Two consequences. The response discloses the integration, and frequently its endpoint, client library ` +
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
                    remediation: 'Catch upstream failures at the integration boundary and translate them into this API\'s own error ' +
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
        const intakes = context.endpoints
            .filter((endpoint) => ['POST', 'PUT'].includes(endpoint.method.toUpperCase()))
            .map((endpoint) => ({ endpoint, term: (0, upstream_signals_1.webhookIntakeTerm)(endpoint.path, endpoint.summary) }))
            .filter((candidate) => candidate.term !== null)
            .slice(0, 3);
        for (const { endpoint, term } of intakes) {
            const signatureHeader = (0, upstream_signals_1.declaredSignatureHeader)((endpoint.parameters ?? [])
                .filter((parameter) => parameter.in === 'header')
                .map((parameter) => String(parameter.name ?? '')));
            if (signatureHeader)
                continue;
            const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
            const body = { [brand_1.appBrand.scannerProbeField]: context.assessmentId };
            const probeHeaders = {
                ...anonymousHeaders,
                'Content-Type': 'application/json',
                [brand_1.appBrand.scannerProbeHeader]: 'webhook-intake',
            };
            const intakeBaseline = await this.send(endpoint.method, this.nonexistentUrl(context.baseUrl), probeHeaders, body);
            const response = await this.send(endpoint.method, url, probeHeaders, body);
            tested++;
            if (!response || !(0, request_outcome_1.wasProcessed)(response.status))
                continue;
            if (intakeBaseline && !(0, baseline_1.isDistinctFromBaseline)(response, intakeBaseline))
                continue;
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
                description: `${endpoint.method} ${endpoint.path} is an intake endpoint — identified by the term "${term}" in its ` +
                    `definition — that exists to receive calls from a third party. It declares no signature header ` +
                    `(\`X-Hub-Signature\`, \`Stripe-Signature\` or equivalent), and a request carrying no credentials and no ` +
                    `signature was processed by the application: HTTP ${response.status}. Anyone who can reach this URL can ` +
                    `therefore submit data that the service will treat as coming from the provider.`,
                impact: 'A webhook payload usually drives a state change that is trusted precisely because of where it came ' +
                    'from: a payment marked settled, a subscription activated, an account upgraded, a job accepted. Without ' +
                    'sender verification an attacker asserts those events directly, and the resulting records look ' +
                    'legitimate in every downstream system.',
                likelihood: 'HIGH',
                riskScore: 7.5,
                evidence: {
                    intakeTerm: term,
                    declaredHeaderParameters: (endpoint.parameters ?? [])
                        .filter((parameter) => parameter.in === 'header')
                        .map((parameter) => parameter.name),
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
    nonexistentUrl(baseUrl) {
        return this.buildUrl(baseUrl, `${brand_1.appBrand.fileSlug}-probe-${(0, node_crypto_1.randomUUID)().slice(0, 12)}`);
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
                body: text.slice(0, 8000),
                bodyLength: text.length,
            };
        }
        catch {
            return null;
        }
    }
    hostOf(baseUrl) {
        try {
            return new URL(baseUrl).hostname;
        }
        catch {
            return null;
        }
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
    result(findings, start, tested) {
        return {
            pluginId: this.id,
            pluginName: this.name,
            findings,
            scanDuration: Date.now() - start,
            endpointsTested: tested,
        };
    }
}
exports.ApiConsumptionPlugin = ApiConsumptionPlugin;
//# sourceMappingURL=api-consumption.plugin.js.map