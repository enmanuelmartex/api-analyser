import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BusinessFlowsPlugin } from './business-flows/business-flows.plugin';
import { InventoryPlugin } from './inventory/inventory.plugin';
import { ApiConsumptionPlugin } from './api-consumption/api-consumption.plugin';
import type { BasePlugin, ParsedEndpoint, ScanContext } from '../types/scanner.types';

/**
 * The three checks that close API6, API9 and API10, run against real HTTP.
 *
 * Their helper modules are unit-tested; what this file covers is the part that
 * only appears once requests are actually made — and in particular the two
 * failure modes that would make the checks worse than nothing:
 *
 *   1. A hardened target must produce zero findings. A check that reports on a
 *      correctly built API is noise, and noise is how a security tool teaches
 *      its users to ignore it.
 *   2. A target that answers everything identically — a single-page app, a
 *      catch-all gateway, a base URL naming the wrong host — must produce zero
 *      findings. Without the baseline comparison these checks would report
 *      HIGH severity issues against payment flows that were never deployed,
 *      which is the most damaging thing a scanner can do.
 */

const json = (
  res: Parameters<Parameters<typeof createServer>[1]>[1],
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** An API with every weakness the three checks look for. */
function vulnerableTarget(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    switch (path) {
      case '/openapi.json':
        return json(res, 200, { openapi: '3.0.0', paths: {} });
      case '/actuator/env':
        return json(res, 200, { activeProfiles: ['prod'], propertySources: [] });
      case '/v1/checkout':
      case '/v2/checkout':
        return json(res, 400, { error: 'invalid payload' });
      case '/v1/orders':
      case '/v2/orders':
        return json(res, 200, { items: [], page: 1 });
      case '/v1/legacy-report':
        return json(res, 200, { report: 'still here', rows: [1, 2, 3] });
      case '/v1/integrations/sync':
        return json(res, 200, { feed: 'http://feeds.partner-example.org/v1/items' });
      case '/v1/integrations/status':
        return json(res, 502, { message: 'connect ECONNREFUSED api.stripe.com:443' });
      case '/v1/webhooks/provider':
        return json(res, 202, { received: true });
      default:
        return json(res, 404, { error: 'Not Found' });
    }
  });
}

/** The same API with the controls in place. */
function hardenedTarget(): Server {
  let checkoutHits = 0;

  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const authed = Boolean(req.headers.authorization);

    if (path === '/v1/checkout') {
      if (!authed) return json(res, 401, { error: 'unauthorized' });
      if (++checkoutHits > 3) {
        return json(res, 429, { error: 'slow down' }, { 'retry-after': '30' });
      }
      return json(res, 400, { error: 'invalid payload' }, { 'x-ratelimit-limit': '3' });
    }

    if (path === '/v1/orders') {
      return authed ? json(res, 200, { items: [] }) : json(res, 401, { error: 'unauthorized' });
    }

    if (path === '/v1/webhooks/provider') {
      return json(res, 401, { error: 'missing signature' });
    }

    return json(res, 404, { error: 'Not Found' });
  });
}

/** A host that answers 200 with the same document whatever is asked of it. */
function catchAllTarget(): Server {
  return createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const endpoint = (path: string, method: string, extra: Partial<ParsedEndpoint> = {}): ParsedEndpoint => ({
  id: `${method} ${path}`,
  path,
  method,
  parameters: [],
  security: [],
  ...extra,
});

/** The specification handed to the scanner, identical for all three targets. */
const ENDPOINTS: ParsedEndpoint[] = [
  endpoint('/v1/orders', 'GET'),
  endpoint('/v1/checkout', 'POST', { security: [{ bearerAuth: [] }] }),
  endpoint('/v1/legacy-report', 'GET', { deprecated: true }),
  endpoint('/v1/integrations/sync', 'GET'),
  endpoint('/v1/integrations/status', 'GET'),
  endpoint('/v1/webhooks/provider', 'POST'),
];

const contextFor = (baseUrl: string): ScanContext => ({
  assessmentId: 'spec-assessment',
  projectId: 'spec-project',
  baseUrl,
  auth: { type: 'BEARER', token: 'spec-token' },
  endpoints: ENDPOINTS,
  config: {
    executionMode: 'all',
    enableAiAnalysis: false,
    maxRequestsPerEndpoint: 10,
    requestDelayMs: 0,
    timeoutMs: 5000,
  },
});

async function rulesFrom(plugin: BasePlugin, baseUrl: string): Promise<string[]> {
  const result = await plugin.run(contextFor(baseUrl), plugin.manifest.defaultConfig ?? {});
  return result.findings.map((finding) => finding.ruleId).sort();
}

const servers = {
  vulnerable: vulnerableTarget(),
  hardened: hardenedTarget(),
  catchAll: catchAllTarget(),
};
const urls: Record<keyof typeof servers, string> = { vulnerable: '', hardened: '', catchAll: '' };

beforeAll(async () => {
  urls.vulnerable = await listen(servers.vulnerable);
  urls.hardened = await listen(servers.hardened);
  urls.catchAll = await listen(servers.catchAll);
});

afterAll(async () => {
  await Promise.all(Object.values(servers).map(close));
});

describe('a target with the weaknesses each check looks for', () => {
  it('reports every business-flow rule against an unprotected payment flow', async () => {
    expect(await rulesFrom(new BusinessFlowsPlugin(), urls.vulnerable)).toEqual([
      'business-flow.missing-idempotency-control',
      'business-flow.no-anti-automation',
      'business-flow.unauthenticated-access',
    ]);
  });

  it('finds the shadow version, the live deprecation and the exposed surfaces', async () => {
    const rules = await rulesFrom(new InventoryPlugin(), urls.vulnerable);

    expect(rules).toContain('inventory.undocumented-version');
    expect(rules).toContain('inventory.deprecated-endpoint-live');
    expect(rules).toContain('inventory.documentation-exposed');
    expect(rules).toContain('inventory.management-surface-exposed');
  });

  it('finds the plaintext upstream, the relayed upstream error and the open webhook', async () => {
    expect(await rulesFrom(new ApiConsumptionPlugin(), urls.vulnerable)).toEqual([
      'consumption.insecure-upstream-url',
      'consumption.unauthenticated-webhook-intake',
      'consumption.upstream-error-passthrough',
    ]);
  });
});

describe('a target with the controls in place', () => {
  it('is reported clean by all three checks', async () => {
    expect(await rulesFrom(new BusinessFlowsPlugin(), urls.hardened)).toEqual([]);
    expect(await rulesFrom(new InventoryPlugin(), urls.hardened)).toEqual([]);
    expect(await rulesFrom(new ApiConsumptionPlugin(), urls.hardened)).toEqual([]);
  });
});

/**
 * A registration endpoint with no throttle in front of it — realistic, since
 * an account-creation form is public by construction. This is the case
 * `isPublicByDesignAccountFlow` exists for: the missing anti-automation
 * control is a real, reportable gap, but "accepts unauthenticated requests"
 * is not a finding here, because a caller registering an account cannot
 * possibly hold a session for it yet.
 */
function registrationTarget(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/v1/auth/register' && req.method === 'POST') {
      return json(res, 201, { id: 'new-user' });
    }
    return json(res, 404, { error: 'Not Found' });
  });
}

describe('a public-by-design registration flow with no anti-automation control', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = registrationTarget();
    url = await listen(server);
  });

  afterAll(() => close(server));

  it('reports the missing throttle but not "accepts unauthenticated requests"', async () => {
    const context: ScanContext = {
      ...contextFor(url),
      endpoints: [endpoint('/v1/auth/register', 'POST')],
    };

    const result = await new BusinessFlowsPlugin().run(context, {});
    const rules = result.findings.map((f) => f.ruleId).sort();

    expect(rules).toEqual(['business-flow.no-anti-automation']);
    expect(rules).not.toContain('business-flow.unauthenticated-access');
  });
});

describe('a host that answers everything the same way', () => {
  /*
   * The wrong-base-URL case, and the reason every one of these checks takes a
   * baseline first. Each probe here "succeeds": the catch-all returns 200 to a
   * checkout burst, to an unauthenticated webhook post and to /v2/orders. Only
   * the comparison against a route that does not exist tells the checks that
   * none of it means anything.
   */
  it('produces no findings at all', async () => {
    expect(await rulesFrom(new BusinessFlowsPlugin(), urls.catchAll)).toEqual([]);
    expect(await rulesFrom(new InventoryPlugin(), urls.catchAll)).toEqual([]);
    expect(await rulesFrom(new ApiConsumptionPlugin(), urls.catchAll)).toEqual([]);
  });
});
