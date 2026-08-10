import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { BasePlugin, ScanContext, PluginResult, ScanFinding } from '../../types/scanner.types';
import { PluginManifest, PluginCategory } from '../../types/plugin-manifest.types';
import { appBrand } from '../../../../brand/brand';
import { isDistinctFromBaseline, type ProbeObservation } from '../shared/baseline';
import {
  DOCUMENTATION_PROBES,
  MANAGEMENT_PROBES,
  indicatesLiveRoute,
  nonProductionMarker,
  siblingVersions,
  swapVersion,
  versionSegmentOf,
  type SurfaceProbe,
} from './inventory-probes';

interface ProbeResult extends ProbeObservation {
  url: string;
  headers: Record<string, string>;
  body: string;
  reachable: boolean;
}

/**
 * API9:2023 — Improper Inventory Management.
 *
 * The category is about the API surface an organisation has forgotten it is
 * serving: the previous version nobody decommissioned, the deprecated route
 * still answering, the documentation and management endpoints published beside
 * the API itself.
 *
 * Every finding here rests on a comparison against a *baseline* — a request to
 * a path that certainly does not exist on the same host. Without it, a server
 * with a catch-all route makes every probe look like a discovery. With it, a
 * finding means the server treated the probed route differently from nonsense,
 * which is the only black-box evidence that a route exists.
 *
 * Scope: this examines the host under assessment and nothing else. It cannot
 * find a shadow API on a different hostname — that needs an asset inventory the
 * scanner is not given, and probing hosts the user did not nominate would be
 * scanning something nobody authorised.
 */
export class InventoryPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'inventory',
    name: 'API Inventory & Exposure',
    version: '1.0.0',
    description: 'Tests for API9:2023 - Improper Inventory Management',
    longDescription:
      'Establishes how the target responds to a route that does not exist, then uses that baseline to detect undocumented API versions beside the documented ones, deprecated operations still being served, and documentation, actuator, metrics and debug surfaces reachable without credentials. Confined to the host under assessment; no other hostname is contacted.',
    author: appBrand.pluginAuthor,
    license: 'MIT',
    category: PluginCategory.INFRASTRUCTURE,
    owaspMappings: ['API9:2023'],
    cweIds: ['CWE-1059', 'CWE-1104', 'CWE-497', 'CWE-215'],
    tags: ['inventory', 'shadow-api', 'deprecation', 'exposure', 'owasp-top10'],
    supportedApiTypes: ['REST'],
    permissions: ['http:read', 'findings:write'],
    configFields: [
      {
        key: 'probeManagementSurfaces',
        label: 'Probe management and debug surfaces',
        description:
          'Requests well-known actuator, metrics and debug paths on the target host. Disable when the target is shared infrastructure you do not own.',
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

  async run(context: ScanContext, pluginConfig: Record<string, any> = {}): Promise<PluginResult> {
    const start = Date.now();
    const findings: ScanFinding[] = [];
    let tested = 0;

    const probeManagement = pluginConfig.probeManagementSurfaces !== false;
    const maxVersionProbes = this.clamp(pluginConfig.maxVersionProbes ?? 4, 1, 10);

    const authHeaders = this.getAuthHeaders(context.auth);
    const anonymousHeaders = this.getAuthHeaders({ type: 'NONE' });

    const target = this.parseTarget(context.baseUrl);
    if (!target) {
      return this.result(findings, start, tested);
    }

    // ── Baselines: what does "this route does not exist" look like here? ──────
    const [baseBaseline, originBaseline] = await Promise.all([
      this.probe(`${target.base}/${this.nonce()}`, authHeaders),
      this.probe(`${target.origin}/${this.nonce()}`, anonymousHeaders),
    ]);

    /*
     * Without a baseline there is nothing to compare against, and every
     * subsequent claim would be unfounded. An unreachable target is reported by
     * the scan itself; this check simply declines to invent findings.
     */
    if (!baseBaseline.reachable && !originBaseline.reachable) {
      return this.result(findings, start, tested);
    }

    // ── Undocumented versions beside the documented ones ──────────────────────
    const documentedVersions = new Set<string>();
    for (const endpoint of context.endpoints) {
      const version = versionSegmentOf(endpoint.path);
      if (version) documentedVersions.add(version);
    }
    const baseVersion = versionSegmentOf(target.basePath);
    if (baseVersion) documentedVersions.add(baseVersion);

    const versionProbes = this.planVersionProbes(
      context,
      target,
      documentedVersions,
      maxVersionProbes,
    );

    if (versionProbes.length > 0 && baseBaseline.reachable) {
      const results = await Promise.all(
        versionProbes.map(async (plan) => ({ plan, response: await this.probe(plan.url, authHeaders) })),
      );
      tested += results.length;

      for (const { plan, response } of results) {
        if (!response.reachable) continue;
        if (!indicatesLiveRoute(response.status)) continue;
        if (!isDistinctFromBaseline(response, baseBaseline)) continue;

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
          description:
            `The specification documents version "${plan.documentedVersion}". A request to the same route under ` +
            `"${plan.candidateVersion}" returned HTTP ${response.status}, while a request to a path that does not ` +
            `exist on this host returned HTTP ${baseBaseline.status} (${baseBaseline.bodyLength} bytes versus ` +
            `${response.bodyLength} bytes). The server therefore routes "${plan.candidateVersion}" — it is being ` +
            `served, but it is not in the specification under assessment, so nothing in this scan tested it.`,
          impact:
            'An older or newer version left in service is the version that stops receiving fixes. It commonly ' +
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

    // ── Deprecated operations that are still answering ────────────────────────
    const deprecated = context.endpoints
      .filter((endpoint) => endpoint.deprecated && endpoint.method.toUpperCase() === 'GET')
      .slice(0, 4);

    if (deprecated.length > 0 && baseBaseline.reachable) {
      const results = await Promise.all(
        deprecated.map(async (endpoint) => {
          const url = this.buildUrl(context.baseUrl, this.fillPathParams(endpoint.path));
          return { endpoint, url, response: await this.probe(url, authHeaders) };
        }),
      );
      tested += results.length;

      for (const { endpoint, url, response } of results) {
        if (!response.reachable) continue;
        if (!indicatesLiveRoute(response.status)) continue;
        if (!isDistinctFromBaseline(response, baseBaseline)) continue;

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
          description:
            `The specification marks ${endpoint.method} ${endpoint.path} as deprecated, and the endpoint returned ` +
            `HTTP ${response.status} while a non-existent path on the same host returned HTTP ${baseBaseline.status}. ` +
            `The operation is therefore still in service. ` +
            (sunsetHeader
              ? `It does advertise a retirement date (${sunsetHeader}).`
              : `It advertises no retirement date: neither a \`Sunset\` nor a \`Deprecation\` response header was returned, ` +
                `so a client integrating against it today has no signal that it is going away.`),
          impact:
            'Deprecated code paths keep working while attention moves elsewhere: they are the routes that miss the ' +
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
          remediation:
            'Publish a sunset date with `Deprecation` and `Sunset` response headers, tell the identified consumers, ' +
            'then remove the route. A deprecation that never ends is documentation, not a control — until the code ' +
            'is gone it is part of the attack surface and must be scanned and patched like any other route.',
          references: [
            'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
            'https://datatracker.ietf.org/doc/html/rfc8594',
          ],
        });
      }
    }

    // ── Documentation and management surfaces reachable without credentials ───
    if (originBaseline.reachable) {
      const surfaces: SurfaceProbe[] = [
        ...DOCUMENTATION_PROBES,
        ...(probeManagement ? MANAGEMENT_PROBES : []),
      ];

      const results = await Promise.all(
        surfaces.map(async (surface) => ({
          surface,
          url: `${target.origin}${surface.path}`,
          response: await this.probe(`${target.origin}${surface.path}`, anonymousHeaders),
        })),
      );
      tested += results.length;

      for (const { surface, url, response } of results) {
        if (!response.reachable) continue;
        if (response.status < 200 || response.status >= 300) continue;
        if (!isDistinctFromBaseline(response, originBaseline)) continue;
        /*
         * Content has to confirm the surface. A 200 alone is how a scanner ends
         * up telling a user their single-page app is a Spring Actuator.
         */
        if (!surface.matches(response.body)) continue;

        const isDocumentation = DOCUMENTATION_PROBES.includes(surface);

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
          description:
            `A request to ${surface.path} carrying no credentials returned HTTP ${response.status} with content ` +
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

    // ── Is this a production host at all? ─────────────────────────────────────
    const marker = nonProductionMarker(target.hostname);
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
        description:
          `The host "${target.hostname}" carries the label "${marker}", which conventionally identifies a ` +
          `non-production environment, and it responded to requests. This is recorded because it changes how the ` +
          `rest of this report should be read, and because it is worth confirming the host is only reachable by ` +
          `people who are supposed to reach it.`,
        impact:
          'Two separate consequences. The findings here describe this environment, and configuration commonly ' +
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
        remediation:
          'Confirm this host is meant to be reachable from where the scan ran. Non-production environments belong ' +
          'behind a VPN or an allowlist, and should hold synthetic data rather than a copy of production. Re-run ' +
          'the assessment against the production host before treating its results as a production statement.',
        references: [
          'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
        ],
      });
    }

    return this.result(findings, start, tested);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Which alternate versions to probe, and on which route.
   *
   * A version segment can live in the base URL (`https://host/api/v1`) or in the
   * documented paths (`/v1/orders`). Both are handled, because which one an API
   * uses is a matter of taste and the check should not depend on it.
   */
  private planVersionProbes(
    context: ScanContext,
    target: { origin: string; base: string; basePath: string },
    documentedVersions: ReadonlySet<string>,
    limit: number,
  ): Array<{ url: string; probePath: string; documentedVersion: string; candidateVersion: string }> {
    const plans: Array<{ url: string; probePath: string; documentedVersion: string; candidateVersion: string }> = [];

    const canary = context.endpoints.find((endpoint) => endpoint.method.toUpperCase() === 'GET')
      ?? context.endpoints[0];
    if (!canary) return plans;

    const canaryPath = this.fillPathParams(canary.path);

    const pathVersion = versionSegmentOf(canary.path);
    if (pathVersion) {
      for (const candidate of siblingVersions(pathVersion, documentedVersions)) {
        const probePath = swapVersion(canaryPath, pathVersion, candidate);
        plans.push({
          url: this.buildUrl(context.baseUrl, probePath),
          probePath,
          documentedVersion: pathVersion,
          candidateVersion: candidate,
        });
      }
    }

    const baseVersion = versionSegmentOf(target.basePath);
    if (baseVersion) {
      for (const candidate of siblingVersions(baseVersion, documentedVersions)) {
        const probeBase = `${target.origin}${swapVersion(target.basePath, baseVersion, candidate)}`;
        plans.push({
          url: this.buildUrl(probeBase, canaryPath),
          probePath: `${swapVersion(target.basePath, baseVersion, candidate)}${canaryPath.startsWith('/') ? '' : '/'}${canaryPath}`,
          documentedVersion: baseVersion,
          candidateVersion: candidate,
        });
      }
    }

    return plans.slice(0, limit);
  }

  private parseTarget(baseUrl: string): { origin: string; base: string; basePath: string; hostname: string } | null {
    try {
      const parsed = new URL(baseUrl);
      const basePath = parsed.pathname.replace(/\/$/, '');
      return {
        origin: parsed.origin,
        base: `${parsed.origin}${basePath}`,
        basePath,
        hostname: parsed.hostname,
      };
    } catch {
      return null;
    }
  }

  private async probe(url: string, headers: Record<string, string>): Promise<ProbeResult> {
    try {
      const response = await axios.request({
        method: 'GET',
        url,
        headers,
        timeout: 5000,
        maxRedirects: 0,
        validateStatus: () => true,
        // Some management surfaces answer in plain text; keep the raw body so a
        // fingerprint can be matched against it either way.
        transformResponse: [(data) => data],
        responseType: 'text',
      });

      const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');

      return {
        url,
        status: response.status,
        bodyLength: body.length,
        body: body.slice(0, 4000),
        headers: this.lowercaseKeys(response.headers as any),
        reachable: true,
      };
    } catch {
      return { url, status: 0, bodyLength: 0, body: '', headers: {}, reachable: false };
    }
  }

  private nonce(): string {
    return `${appBrand.fileSlug}-probe-${randomUUID().slice(0, 12)}`;
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
