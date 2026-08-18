import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RateLimitPlugin } from './rate-limit.plugin';
import type { ParsedEndpoint, ScanContext } from '../../types/scanner.types';

/**
 * `rate-limit.missing-headers` used to decide "no rate-limit headers" by
 * looking only at whichever of the 25 concurrent probe requests happened to
 * finish LAST — an artifact of `Promise.all` completion order, which is not
 * send order and is not correlated with which responses were actually 429s.
 * A perfectly compliant API (`Retry-After` on every 429) could still get
 * flagged, purely because the one response that raced to the finish line
 * last wasn't one of the 429s.
 *
 * This server reproduces that race deliberately: it always answers the FIRST
 * connection it receives after a delay, while answering everything after it
 * immediately — so the artificially-delayed response (a 200, since it lands
 * within the limit) is the one still in flight when every 429 has already
 * completed, exactly the scenario that broke the old "last response" check.
 */
function raceProneRateLimitedTarget(limit: number): Server {
  let count = 0;
  return createServer((req, res) => {
    count += 1;
    const isFirstConnection = count === 1;
    const isWithinLimit = count <= limit;

    const respond = () => {
      if (isWithinLimit) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
        res.end(JSON.stringify({ error: 'slow down' }));
      }
    };

    if (isFirstConnection) {
      setTimeout(respond, 250);
    } else {
      respond();
    }
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

const endpoint: ParsedEndpoint = { id: 'ep', path: '/v1/widgets', method: 'GET', parameters: [], security: [] };

function contextFor(baseUrl: string): ScanContext {
  return {
    assessmentId: 'spec-assessment',
    projectId: 'spec-project',
    baseUrl,
    auth: { type: 'NONE' },
    endpoints: [endpoint],
    config: { executionMode: 'all', enableAiAnalysis: false, maxRequestsPerEndpoint: 10, requestDelayMs: 0, timeoutMs: 5000 },
  };
}

describe('rate-limit.missing-headers — response correlation under concurrency', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = raceProneRateLimitedTarget(5);
    url = await listen(server);
  });

  afterAll(() => close(server));

  it('does not report missing headers when every 429 actually carries Retry-After, even though the slowest response was a 200', async () => {
    const result = await new RateLimitPlugin().run(contextFor(url));

    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).not.toContain('rate-limit.missing-headers');
    expect(rules).not.toContain('rate-limit.absent');
  }, 15_000);
});
