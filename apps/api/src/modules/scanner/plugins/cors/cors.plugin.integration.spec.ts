import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CorsPlugin } from './cors.plugin';
import type { ParsedEndpoint, ScanContext } from '../../types/scanner.types';

/**
 * `cors.preflight-dangerous-methods` used to treat "DELETE appears in
 * Access-Control-Allow-Methods" as sufficient evidence of a HIGH-severity
 * destructive-action vulnerability. It is not: that header is emitted by CORS
 * middleware sitting in front of the whole API, not by the specific route
 * being probed, so it says nothing about whether a browser at an untrusted
 * origin could ever deliver the request or whether the server would act on it
 * if it did. These tests pin the corrected behaviour — real exploitability
 * requires the SAME preflight to also accept the attacker's origin, and the
 * specification to actually define the dangerous method on that path.
 */

const FRONTEND_ORIGIN = 'https://app.legit-frontend.test';

function corsServer(options: {
  reflectOrigin: boolean;
  implementsDelete: boolean;
}): Server {
  return createServer((req, res) => {
    const origin = req.headers.origin;
    const acao = options.reflectOrigin ? origin ?? FRONTEND_ORIGIN : FRONTEND_ORIGIN;

    // Every route gets the same permissive method list back — the realistic
    // shape of a CORS misconfiguration: one global `enableCors({ methods: [...] })`
    // call, independent of what any given route implements.
    const corsHeaders = {
      'access-control-allow-origin': acao,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    if (req.method === 'DELETE' && options.implementsDelete && req.url === '/v1/widgets/1') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
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

function contextFor(baseUrl: string, endpoints: ParsedEndpoint[]): ScanContext {
  return {
    assessmentId: 'spec-assessment',
    projectId: 'spec-project',
    baseUrl,
    auth: { type: 'NONE' },
    endpoints,
    config: {
      executionMode: 'all',
      enableAiAnalysis: false,
      maxRequestsPerEndpoint: 10,
      requestDelayMs: 0,
      timeoutMs: 5000,
    },
  };
}

const GET_WIDGET: ParsedEndpoint = {
  id: 'get-widget',
  path: '/v1/widgets/1',
  method: 'GET',
  parameters: [],
  security: [],
};

const DELETE_WIDGET_PUBLIC: ParsedEndpoint = {
  id: 'delete-widget',
  path: '/v1/widgets/1',
  method: 'DELETE',
  parameters: [],
  security: [],
};

describe('cors.preflight-dangerous-methods — real exploitability', () => {
  let notExploitableServer: Server;
  let notExploitableUrl: string;
  let exploitableServer: Server;
  let exploitableUrl: string;

  beforeAll(async () => {
    // Advertises DELETE globally, but (a) does not reflect an untrusted
    // origin and (b) has no DELETE operation on the probed path — the exact
    // shape of the false positive being fixed.
    notExploitableServer = corsServer({ reflectOrigin: false, implementsDelete: false });
    notExploitableUrl = await listen(notExploitableServer);

    // Reflects any origin AND genuinely implements DELETE on the probed path.
    exploitableServer = corsServer({ reflectOrigin: true, implementsDelete: true });
    exploitableUrl = await listen(exploitableServer);
  });

  afterAll(async () => {
    await close(notExploitableServer);
    await close(exploitableServer);
  });

  it('does not report a HIGH destructive finding when the origin is not actually accepted and DELETE is not implemented', async () => {
    const result = await new CorsPlugin().run(contextFor(notExploitableUrl, [GET_WIDGET]));

    const finding = result.findings.find((f) => f.ruleId === 'cors.preflight-dangerous-methods');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('LOW');
    expect(finding!.title).toBe('CORS Preflight Advertises Destructive Methods Regardless of Origin');
    expect(finding!.evidence.originAccepted).toBe(false);
    expect(finding!.evidence.methodImplementedInSpec).toBe(false);
    expect(finding!.evidence.confidence).toBe('LOW');
  });

  it('reports the real vulnerability when the origin is accepted and DELETE is a genuine operation on the path', async () => {
    const result = await new CorsPlugin().run(
      contextFor(exploitableUrl, [GET_WIDGET, DELETE_WIDGET_PUBLIC]),
    );

    const finding = result.findings.find((f) => f.ruleId === 'cors.preflight-dangerous-methods');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('HIGH');
    expect(finding!.title).toBe('CORS Preflight Allows Cross-Origin DELETE from an Untrusted Origin');
    expect(finding!.evidence.originAccepted).toBe(true);
    expect(finding!.evidence.methodImplementedInSpec).toBe(true);
    expect(finding!.evidence.confidence).toBe('HIGH');
  });

  it('never sends a live DELETE to the target while reaching either verdict', async () => {
    let deleteReceived = false;
    const server = createServer((req, res) => {
      if (req.method === 'DELETE') deleteReceived = true;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': FRONTEND_ORIGIN,
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const url = await listen(server);

    await new CorsPlugin().run(contextFor(url, [GET_WIDGET, DELETE_WIDGET_PUBLIC]));
    await close(server);

    expect(deleteReceived).toBe(false);
  });
});
