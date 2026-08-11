"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryPlugin = void 0;
const axios_1 = require("axios");
const node_crypto_1 = require("node:crypto");
const scanner_types_1 = require("../../types/scanner.types");
const plugin_manifest_types_1 = require("../../types/plugin-manifest.types");
const brand_1 = require("../../../../brand/brand");
const baseline_1 = require("../shared/baseline");
const inventory_probes_1 = require("./inventory-probes");
class InventoryPlugin extends scanner_types_1.BasePlugin {
    constructor() {
        super(...arguments);
        this.manifest = {
            id: 'inventory',
            name: 'API Inventory & Exposure',
            version: '1.0.0',
            description: 'Tests for API9:2023 - Improper Inventory Management',
            longDescription: 'Establishes how the target responds to a route that does not exist, then uses that baseline to detect undocumented API versions beside the documented ones, deprecated operations still being served, and documentation, actuator, metrics and debug surfaces reachable without credentials. Confined to the host under assessment; no other hostname is contacted.',
            author: brand_1.appBrand.pluginAuthor,
            license: 'MIT',
            category: plugin_manifest_types_1.PluginCategory.INFRASTRUCTURE,
            owaspMappings: ['API9:2023'],
            cweIds: ['CWE-1059', 'CWE-1104', 'CWE-497', 'CWE-215'],
            tags: ['inventory', 'shadow-api', 'deprecation', 'exposure', 'owasp-top10'],
            supportedApiTypes: ['REST'],
            permissions: ['http:read', 'findings:write'],
            configFields: [
                {
                    key: 'probeManagementSurfaces',
                    label: 'Probe management and debug surfaces',
                    description: 'Requests well-known actuator, metrics and debug paths on the target host. Disable when the target is shared infrastructure you do not own.',
                    type: 'boolean',
                    default: true,
                },
                {
                    key: 'maxVersionProbes',
                    label: 'Maximum version probes',
                    description: 'Caps how many neighbouring API versions are probed.',
                    type: 'number',
                    default: 4,
                    min: 1,
                    max: 10,
                },
            ],
            defaultConfig: { probeManagementSurfaces: true, maxVersionProbes: 4 },
            minimumCoreVersion: '1.0.0',
            isBuiltin: true,
            ruleNamespace: 'inventory',
            ruleIds: [
                'inventory.undocumented-version',
                'inventory.deprecated-endpoint-live',
                'inventory.documentation-exposed',
                'inventory.management-surface-exposed',
                'inventory.non-production-target',
            ],
        };
    }
    async run(context, pluginConfig = {}) {
        const start = Date.now();
        const findings = [];
        let tested = 0;
        const probeManagement = pluginConfig.probeManagementSurfaces !== false;
        const maxVersionProbes = this.clamp(pluginConfig.maxVersionProbes ?? 4, 1, 10);
        const authHeaders = this.getAuthHeaders(context.auth);
        const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });
        const target = this.parseTarget(context.baseUrl);
        if (!target) {
            return this.result(findings, start, tested);
        }
        const [baseBaseline, originBaseline] = await Promise.all([
            this.probe(`${target.base}/${this.nonce()}`, authHeaders),
            this.probe(`${target.origin}/${this.nonce()}`, anonymousHeaders),
        ]);
        if (!baseBaseline.reachable && !originBaseline.reachable) {
            return this.result(findings, start, tested);
        }
        const documentedVersions = new Set();
        for (const endpoint of context.endpoints) {
            const version = (0, inventory_probes_1.versionSegmentOf)(endpoint.path);
            if (version)
                documentedVersions.add(version);
        }
        const baseVersion = (0, inventory_probes_1.versionSegmentOf)(target.basePath);
        if (baseVersion)
            documentedVersions.add(baseVersion);
        const versionProbes = this.planVersionProbes(context, target, documentedVersions, maxVersionProbes);
        if (versionProbes.length > 0 && baseBaseline.reachable) {
            const results = await Promise.all(versionProbes.map(async (plan) => ({ plan, response: await this.probe(plan.url, authHeaders) })));
            tested += results.length;
            for (const { plan, response } of results) {
                if (!response.reachable)
                    continue;
                if (!(0, inventory_probes_1.indicatesLiveRoute)(response.status))
                    continue;
                if (!(0, baseline_1.isDistinctFromBaseline)(response, baseBaseline))
                    continue;
                const serving = response.status >= 200 && response.status < 300;
                const guarded = [401, 403, 405].includes(response.status);
                const severity = serving ? 'HIGH' : guarded ? 'MEDIUM' : 'LOW';
                const cvss = serving ? 7.5 : guarded ? 5.3 : 3.7;
                findings.push({
                    title: `Undocumented API version "${plan.candidateVersion}" is still routed`,
                    category: 'Inventory',
                    severity,
                    cvssScore: cvss,
                    owaspCategory: 'API9:2023',
                    cweId: 'CWE-1059',
                    ruleId: 'inventory.undocumented-version',
                    component: 'endpoint',
                    route: plan.probePath,
                    method: 'GET',
                    pluginId: this.id,
                    affectedUrl: `GET ${plan.url}`,
                    description: `The specification documents version "${plan.documentedVersion}". A request to the same route under ` +
                        `"${plan.candidateVersion}" returned HTTP ${response.status}, while a request to a path that does not ` +
                        `exist on this host returned HTTP ${baseBaseline.status} (${baseBaseline.bodyLength} bytes versus ` +
                        `${response.bodyLength} bytes). The server therefore routes "${plan.candidateVersion}" — it is being ` +
                        `served, but it is not in the specification under assessment, so nothing in this scan tested it.`,
                    impact: 'An older or newer version left in service is the version that stops receiving fixes. It commonly ' +
                        'reaches the same data through code that predates the current authorization checks, so an attacker ' +
                        'who is blocked on the documented version simply moves one path segment over.',
                    likelihood: serving ? 'HIGH' : 'MEDIUM',
                    riskScore: cvss,
                    evidence: {
                        documentedVersion: plan.documentedVersion,
                        undocumentedVersion: plan.candidateVersion,
                        probedPath: plan.probePath,
                        probeStatus: response.status,
                        probeBodyLength: response.bodyLength,
                        baselineStatus: baseBaseline.status,
                        baselineBodyLength: baseBaseline.bodyLength,
                    },
                    httpRequest: this.buildRequestString('GET', plan.url, authHeaders),
                    httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
                    remediation: `Bring the version into the inventory or take it out of service:

1. Decide whether "${plan.candidateVersion}" is meant to be reachable. If it is not, remove the routes — a gateway rule returning 404 is enough only if the upstream is also unreachable.
2. If it is meant to be reachable, publish its specification and scan it: an undocumented version is untested by definition.
3. Give retired versions an announced sunset date and return \`Deprecation\` and \`Sunset\` headers while they are still up.
4. Keep an inventory of every deployed version per environment, generated from deployment configuration rather than maintained by hand.`,
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
                        'https://datatracker.ietf.org/doc/html/rfc8594',
                    ],
                });
            }
        }
        const deprecated = context.endpoints
            .filter((endpoint) => endpoint.deprecated && endpoint.method.toUpperCase() === 'GET')
            .slice(0, 4);
        if (deprecated.length > 0 && baseBaseline.reachable) {
            const results = await Promise.all(deprecated.map(async (endpoint) => {
                const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
                return { endpoint, url, response: await this.probe(url, authHeaders) };
            }));
            tested += results.length;
            for (const { endpoint, url, response } of results) {
                if (!response.reachable)
                    continue;
                if (!(0, inventory_probes_1.indicatesLiveRoute)(response.status))
                    continue;
                if (!(0, baseline_1.isDistinctFromBaseline)(response, baseBaseline))
                    continue;
                const serving = response.status >= 200 && response.status < 300;
                const sunsetHeader = response.headers['sunset'] || response.headers['deprecation'];
                findings.push({
                    title: 'Deprecated operation is still being served',
                    category: 'Inventory',
                    severity: serving ? 'MEDIUM' : 'LOW',
                    cvssScore: serving ? 5.3 : 3.1,
                    owaspCategory: 'API9:2023',
                    cweId: 'CWE-1104',
                    ruleId: 'inventory.deprecated-endpoint-live',
                    component: 'endpoint',
                    route: endpoint.path,
                    method: endpoint.method,
                    pluginId: this.id,
                    endpointId: endpoint.id,
                    affectedUrl: `${endpoint.method} ${url}`,
                    description: `The specification marks ${endpoint.method} ${endpoint.path} as deprecated, and the endpoint returned ` +
                        `HTTP ${response.status} while a non-existent path on the same host returned HTTP ${baseBaseline.status}. ` +
                        `The operation is therefore still in service. ` +
                        (sunsetHeader
                            ? `It does advertise a retirement date (${sunsetHeader}).`
                            : `It advertises no retirement date: neither a \`Sunset\` nor a \`Deprecation\` response header was returned, ` +
                                `so a client integrating against it today has no signal that it is going away.`),
                    impact: 'Deprecated code paths keep working while attention moves elsewhere: they are the routes that miss the ' +
                        'authorization change, the validation fix and the dependency upgrade applied to their replacement.',
                    likelihood: 'MEDIUM',
                    riskScore: serving ? 5.3 : 3.1,
                    evidence: {
                        declaredDeprecated: true,
                        status: response.status,
                        baselineStatus: baseBaseline.status,
                        sunsetHeader: sunsetHeader ?? null,
                    },
                    httpRequest: this.buildRequestString(endpoint.method, url, authHeaders),
                    httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
                    remediation: 'Publish a sunset date with `Deprecation` and `Sunset` response headers, tell the identified consumers, ' +
                        'then remove the route. A deprecation that never ends is documentation, not a control — until the code ' +
                        'is gone it is part of the attack surface and must be scanned and patched like any other route.',
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
                        'https://datatracker.ietf.org/doc/html/rfc8594',
                    ],
                });
            }
        }
        if (originBaseline.reachable) {
            const surfaces = [
                ...inventory_probes_1.DOCUMENTATION_PROBES,
                ...(probeManagement ? inventory_probes_1.MANAGEMENT_PROBES : []),
            ];
            const results = await Promise.all(surfaces.map(async (surface) => ({
                surface,
                url: `${target.origin}${surface.path}`,
                response: await this.probe(`${target.origin}${surface.path}`, anonymousHeaders),
            })));
            tested += results.length;
            for (const { surface, url, response } of results) {
                if (!response.reachable)
                    continue;
                if (response.status < 200 || response.status >= 300)
                    continue;
                if (!(0, baseline_1.isDistinctFromBaseline)(response, originBaseline))
                    continue;
                if (!surface.matches(response.body))
                    continue;
                const isDocumentation = inventory_probes_1.DOCUMENTATION_PROBES.includes(surface);
                findings.push({
                    title: `${surface.label} is reachable without authentication`,
                    category: 'Inventory',
                    severity: surface.severity,
                    cvssScore: surface.severity === 'HIGH' ? 7.5 : surface.severity === 'MEDIUM' ? 5.3 : 3.1,
                    owaspCategory: 'API9:2023',
                    cweId: isDocumentation ? 'CWE-215' : 'CWE-497',
                    ruleId: isDocumentation ? 'inventory.documentation-exposed' : 'inventory.management-surface-exposed',
                    component: 'endpoint',
                    route: surface.path,
                    method: 'GET',
                    pluginId: this.id,
                    affectedUrl: `GET ${url}`,
                    description: `A request to ${surface.path} carrying no credentials returned HTTP ${response.status} with content ` +
                        `identifying it as ${surface.label.toLowerCase()}, while a non-existent path on the same host returned ` +
                        `HTTP ${originBaseline.status}. The surface exposes ${surface.discloses}.`,
                    impact: isDocumentation
                        ? 'A published specification hands an attacker the complete route and parameter inventory, including ' +
                            'the internal operations that were never meant to be found by hand. It converts a search problem into ' +
                            'a checklist.'
                        : 'Management and debug surfaces disclose configuration, internal routes and runtime state. They are ' +
                            'the fastest route from "an API is here" to credentials, and they are frequently writable as well as ' +
                            'readable.',
                    likelihood: 'HIGH',
                    riskScore: surface.severity === 'HIGH' ? 7.5 : surface.severity === 'MEDIUM' ? 5.3 : 3.1,
                    evidence: {
                        probedPath: surface.path,
                        status: response.status,
                        bodyLength: response.bodyLength,
                        baselineStatus: originBaseline.status,
                        contentFingerprintMatched: true,
                        bodyPreview: response.body.slice(0, 200),
                    },
                    httpRequest: this.buildRequestString('GET', url, anonymousHeaders),
                    httpResponse: this.buildResponseString(response.status, response.headers, response.body.slice(0, 300)),
                    remediation: isDocumentation
                        ? 'Serve the specification only where it is needed. Keep it behind authentication in production, or ' +
                            'publish it on a documentation host that does not sit in front of the live API, and disable the ' +
                            'interactive console entirely in production builds.'
                        : 'Bind management endpoints to an interface that is not internet-facing, require authentication and an ' +
                            'operator role on them, and expose only the specific endpoints operations actually needs. In Spring ' +
                            'Boot, set `management.server.port` to a separate port and restrict ' +
                            '`management.endpoints.web.exposure.include` rather than leaving it at `*`.',
                    references: [
                        'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
                        isDocumentation
                            ? 'https://cwe.mitre.org/data/definitions/215.html'
                            : 'https://cwe.mitre.org/data/definitions/497.html',
                    ],
                });
            }
        }
        const marker = (0, inventory_probes_1.nonProductionMarker)(target.hostname);
        if (marker && (baseBaseline.reachable || originBaseline.reachable)) {
            findings.push({
                title: 'Target host is named as a non-production environment',
                category: 'Inventory',
                severity: 'INFO',
                owaspCategory: 'API9:2023',
                cweId: 'CWE-1059',
                ruleId: 'inventory.non-production-target',
                component: 'project',
                pluginId: this.id,
                affectedUrl: target.origin,
                description: `The host "${target.hostname}" carries the label "${marker}", which conventionally identifies a ` +
                    `non-production environment, and it responded to requests. This is recorded because it changes how the ` +
                    `rest of this report should be read, and because it is worth confirming the host is only reachable by ` +
                    `people who are supposed to reach it.`,
                impact: 'Two separate consequences. The findings here describe this environment, and configuration commonly ' +
                    'differs from production in both directions, so neither a clean result nor a poor one transfers ' +
                    'automatically. Separately, a non-production environment reachable from outside is itself an inventory ' +
                    'problem: it usually holds copies of real data behind weaker controls.',
                likelihood: 'LOW',
                riskScore: 0,
                evidence: {
                    hostname: target.hostname,
                    matchedLabel: marker,
                    reachable: true,
                },
                remediation: 'Confirm this host is meant to be reachable from where the scan ran. Non-production environments belong ' +
                    'behind a VPN or an allowlist, and should hold synthetic data rather than a copy of production. Re-run ' +
                    'the assessment against the production host before treating its results as a production statement.',
                references: [
                    'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
                ],
            });
        }
        return this.result(findings, start, tested);
    }
    planVersionProbes(context, target, documentedVersions, limit) {
        const plans = [];
        const canary = context.endpoints.find((endpoint) => endpoint.method.toUpperCase() === 'GET')
            ?? context.endpoints[0];
        if (!canary)
            return plans;
        const canaryPath = this.fillPathParams(canary.path);
        const pathVersion = (0, inventory_probes_1.versionSegmentOf)(canary.path);
        if (pathVersion) {
            for (const candidate of (0, inventory_probes_1.siblingVersions)(pathVersion, documentedVersions)) {
                const probePath = (0, inventory_probes_1.swapVersion)(canaryPath, pathVersion, candidate);
                plans.push({
                    url: this.buildUrl(context.baseUrl, probePath),
                    probePath,
                    documentedVersion: pathVersion,
                    candidateVersion: candidate,
                });
            }
        }
        const baseVersion = (0, inventory_probes_1.versionSegmentOf)(target.basePath);
        if (baseVersion) {
            for (const candidate of (0, inventory_probes_1.siblingVersions)(baseVersion, documentedVersions)) {
                const probeBase = `${target.origin}${(0, inventory_probes_1.swapVersion)(target.basePath, baseVersion, candidate)}`;
                plans.push({
                    url: this.buildUrl(probeBase, canaryPath),
                    probePath: `${(0, inventory_probes_1.swapVersion)(target.basePath, baseVersion, candidate)}${canaryPath.startsWith('/') ? '' : '/'}${canaryPath}`,
                    documentedVersion: baseVersion,
                    candidateVersion: candidate,
                });
            }
        }
        return plans.slice(0, limit);
    }
    parseTarget(baseUrl) {
        try {
            const parsed = new URL(baseUrl);
            const basePath = parsed.pathname.replace(/\/$/, '');
            return {
                origin: parsed.origin,
                base: `${parsed.origin}${basePath}`,
                basePath,
                hostname: parsed.hostname,
            };
        }
        catch {
            return null;
        }
    }
    async probe(url, headers) {
        try {
            const response = await axios_1.default.request({
                method: 'GET',
                url,
                headers,
                timeout: 5000,
                maxRedirects: 0,
                validateStatus: () => true,
                transformResponse: [(data) => data],
                responseType: 'text',
            });
            const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
            return {
                url,
                status: response.status,
                bodyLength: body.length,
                body: body.slice(0, 4000),
                headers: this.lowercaseKeys(response.headers),
                reachable: true,
            };
        }
        catch {
            return { url, status: 0, bodyLength: 0, body: '', headers: {}, reachable: false };
        }
    }
    nonce() {
        return `${brand_1.appBrand.fileSlug}-probe-${(0, node_crypto_1.randomUUID)().slice(0, 12)}`;
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
exports.InventoryPlugin = InventoryPlugin;
//# sourceMappingURL=inventory.plugin.js.map