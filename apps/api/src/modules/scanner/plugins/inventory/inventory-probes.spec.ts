import { describe, expect, it } from 'bun:test';
import { isDistinctFromBaseline } from '../shared/baseline';
import {
  DOCUMENTATION_PROBES,
  MANAGEMENT_PROBES,
  indicatesLiveRoute,
  nonProductionMarker,
  siblingVersions,
  swapVersion,
  versionSegmentOf,
} from './inventory-probes';

/**
 * The inventory check reports that a route exists on someone's production
 * infrastructure. That claim is only as good as the baseline comparison behind
 * it, which is what these tests pin down.
 */

describe('isDistinctFromBaseline', () => {
  const baseline = { status: 404, bodyLength: 200 };

  it('treats a different status as a discovery', () => {
    expect(isDistinctFromBaseline({ status: 401, bodyLength: 200 }, baseline)).toBe(true);
  });

  it('treats an identical response as nothing at all', () => {
    // The catch-all case: a host that answers everything the same way must
    // produce no findings, however many paths are probed.
    expect(isDistinctFromBaseline({ status: 404, bodyLength: 200 }, baseline)).toBe(false);
  });

  it('ignores a body that differs only by the path echoed back in the error', () => {
    // `{"error":"Cannot GET /v2/orders"}` against `.../api-analyser-probe-ab12cd` differs
    // by a handful of bytes. Reporting that as a shadow API is the classic
    // false positive this check exists to avoid.
    expect(isDistinctFromBaseline({ status: 404, bodyLength: 212 }, baseline)).toBe(false);
  });

  it('treats a substantially larger body as a discovery', () => {
    expect(isDistinctFromBaseline({ status: 404, bodyLength: 900 }, baseline)).toBe(true);
  });

  it('keeps a floor for tiny baselines, where a ratio alone would be meaningless', () => {
    const empty = { status: 404, bodyLength: 0 };

    expect(isDistinctFromBaseline({ status: 404, bodyLength: 40 }, empty)).toBe(false);
    expect(isDistinctFromBaseline({ status: 404, bodyLength: 400 }, empty)).toBe(true);
  });
});

describe('indicatesLiveRoute', () => {
  it('counts a refusal as existence — an endpoint that rejects us is still there', () => {
    expect(indicatesLiveRoute(401)).toBe(true);
    expect(indicatesLiveRoute(403)).toBe(true);
    expect(indicatesLiveRoute(405)).toBe(true);
  });

  it('does not count an absent route or a failed request', () => {
    expect(indicatesLiveRoute(404)).toBe(false);
    expect(indicatesLiveRoute(410)).toBe(false);
    expect(indicatesLiveRoute(501)).toBe(false);
    expect(indicatesLiveRoute(0)).toBe(false);
  });
});

describe('version reasoning', () => {
  it('finds a version segment and ignores lookalikes', () => {
    expect(versionSegmentOf('/v2/orders')).toBe('v2');
    expect(versionSegmentOf('/api/V1/orders')).toBe('v1');
    expect(versionSegmentOf('/vault/secrets')).toBeNull();
    expect(versionSegmentOf('/v1beta/orders')).toBeNull();
  });

  it('probes the next version first, then the previous one', () => {
    expect(siblingVersions('v2', new Set(['v2']))).toEqual(['v3', 'v1', 'v4']);
  });

  it('never probes a version the specification already documents', () => {
    // An API that documents v1 and v2 has no shadow version among them, so v2
    // drops out and the probes move outward to the versions nobody mentioned.
    expect(siblingVersions('v1', new Set(['v1', 'v2']))).toEqual(['v0', 'v3']);
  });

  it('does not descend below v0', () => {
    expect(siblingVersions('v0', new Set(['v0']))).toEqual(['v1', 'v2']);
  });

  it('swaps only the version segment', () => {
    expect(swapVersion('/v1/orders/v1-summary', 'v1', 'v2')).toBe('/v2/orders/v1-summary');
  });
});

describe('nonProductionMarker', () => {
  it('matches whole hostname labels', () => {
    expect(nonProductionMarker('api.staging.example.com')).toBe('staging');
    expect(nonProductionMarker('qa-api.example.com')).toBe('qa');
  });

  it('does not match a label that merely contains a marker', () => {
    expect(nonProductionMarker('api.example.com')).toBeNull();
    expect(nonProductionMarker('production.example.com')).toBeNull();
    expect(nonProductionMarker('latest.example.com')).toBeNull(); // contains "test"
  });
});

describe('surface fingerprints', () => {
  it('requires content, not just a 200', () => {
    const actuatorEnv = MANAGEMENT_PROBES.find((p) => p.path === '/actuator/env')!;

    expect(actuatorEnv.matches('{"activeProfiles":["prod"],"propertySources":[]}')).toBe(true);
    expect(actuatorEnv.matches('<!doctype html><div id="root"></div>')).toBe(false);
  });

  it('recognises a specification document without matching arbitrary JSON', () => {
    const openapi = DOCUMENTATION_PROBES.find((p) => p.path === '/openapi.json')!;

    expect(openapi.matches('{"openapi":"3.0.0","paths":{}}')).toBe(true);
    expect(openapi.matches('{"data":[],"page":1}')).toBe(false);
  });

  it('recognises Prometheus exposition format only at the start of a line', () => {
    const metrics = MANAGEMENT_PROBES.find((p) => p.path === '/metrics')!;

    expect(metrics.matches('# HELP http_requests_total Total requests\n# TYPE counter')).toBe(true);
    expect(metrics.matches('{"note":"see # HELP in the docs"}')).toBe(false);
  });
});
