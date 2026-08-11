import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, reportsApi, filenameFromContentDisposition } from './api';
import { REPORTS_PAGE_SIZE, REPORTS_PAGE_SIZE_OPTIONS } from '@/components/reports/reports-table';
import { PAINT_ORDER, SERIES } from '@/components/reports/vulnerability-trend-chart';

/**
 * The Reports client contract.
 *
 * The bug these guard against was entirely in the *routing* of two actions:
 * "Download" issued the generation request, so every download created a report.
 * These assert which endpoint and which HTTP verb each action reaches — the
 * property that broke — without needing a DOM.
 *
 * The web app has no component test runner, so rendering behaviour is verified
 * manually; see the report's "Manual Verification Steps".
 */

interface Call {
  method: 'get' | 'post' | 'delete';
  url: string;
  config?: any;
  body?: any;
}

let calls: Call[];
const original = { get: api.get, post: api.post, delete: api.delete };

beforeEach(() => {
  calls = [];

  api.get = mock(async (url: string, config?: any) => {
    calls.push({ method: 'get', url, config });
    if (url.endsWith('/download')) {
      return {
        data: new Blob(['%PDF-1.4']),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="api-analyser-payments-technical-2026-07-27.pdf"',
        },
      };
    }
    return { data: [], headers: {} };
  }) as any;

  api.post = mock(async (url: string, body?: any) => {
    calls.push({ method: 'post', url, body });
    return { data: { report: { id: 'r1' }, created: true }, headers: {} };
  }) as any;

  api.delete = mock(async (url: string) => {
    calls.push({ method: 'delete', url });
    return { data: {}, headers: {} };
  }) as any;

  // jsdom-free stubs for the anchor-click download.
  (globalThis as any).URL.createObjectURL = mock(() => 'blob:mock');
  (globalThis as any).URL.revokeObjectURL = mock(() => undefined);
  const anchor = { href: '', download: '', click: mock(() => undefined), remove: mock(() => undefined) };
  (globalThis as any).document = {
    createElement: mock(() => anchor),
    body: { appendChild: mock(() => undefined) },
  };
  (globalThis as any).__anchor = anchor;
});

afterEach(() => {
  api.get = original.get;
  api.post = original.post;
  api.delete = original.delete;
});

describe('download', () => {
  it('calls the download endpoint — never the generation one', async () => {
    await reportsApi.download('report-123');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('get');
    expect(calls[0].url).toBe('/reports/report-123/download');
    expect(calls[0].url).not.toContain('generate');
  });

  it('requests the artifact as a blob so binary formats survive the transfer', async () => {
    await reportsApi.download('report-123');
    expect(calls[0].config?.responseType).toBe('blob');
  });

  it('saves under the file name the server chose, not one re-derived here', async () => {
    await reportsApi.download('report-123');
    expect((globalThis as any).__anchor.download).toBe('api-analyser-payments-technical-2026-07-27.pdf');
  });

  it('issues no POST — downloading can never create a resource', async () => {
    await reportsApi.download('report-123');
    expect(calls.filter((call) => call.method === 'post')).toHaveLength(0);
  });
});

describe('generate', () => {
  it('POSTs to the generation endpoint', async () => {
    await reportsApi.generate('scan-1', 'PDF', 'TECHNICAL');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('post');
    expect(calls[0].url).toBe('/reports/assessment/scan-1/generate');
  });

  it('does not ask for regeneration unless explicitly told to', async () => {
    await reportsApi.generate('scan-1', 'PDF', 'TECHNICAL');
    expect(calls[0].body).toMatchObject({ format: 'PDF', type: 'TECHNICAL', regenerate: false });
  });

  it('passes regenerate through for the deliberate new-version action', async () => {
    await reportsApi.generate('scan-1', 'HTML', 'EXECUTIVE', { regenerate: true });
    expect(calls[0].body).toMatchObject({ format: 'HTML', type: 'EXECUTIVE', regenerate: true });
  });

  it('downloads nothing on its own — generation and download stay separate', async () => {
    await reportsApi.generate('scan-1', 'PDF');
    expect(calls.some((call) => call.url.includes('/download'))).toBe(false);
  });
});

describe('list', () => {
  it('omits superseded versions unless history is requested', async () => {
    await reportsApi.list();
    expect(calls[0].config?.params).toEqual({});

    await reportsApi.list({ includeHistory: true });
    expect(calls[1].config?.params).toMatchObject({ includeHistory: 'true' });
  });

  it('scopes to an assessment when asked', async () => {
    await reportsApi.list({ assessmentId: 'scan-9' });
    expect(calls[0].config?.params).toMatchObject({ assessmentId: 'scan-9' });
  });
});

describe('filenameFromContentDisposition', () => {
  it('prefers the RFC 5987 form so non-ASCII names survive', () => {
    const header = `attachment; filename="informe-_.pdf"; filename*=UTF-8''${encodeURIComponent('informe-ñ.pdf')}`;
    expect(filenameFromContentDisposition(header)).toBe('informe-ñ.pdf');
  });

  it('falls back to the quoted form', () => {
    expect(filenameFromContentDisposition('attachment; filename="report.sarif"')).toBe('report.sarif');
  });

  it('returns null when there is no name to read', () => {
    expect(filenameFromContentDisposition('attachment')).toBeNull();
    expect(filenameFromContentDisposition(undefined)).toBeNull();
    expect(filenameFromContentDisposition(42)).toBeNull();
  });
});

describe('reports pagination defaults', () => {
  it('opens on five rows', () => {
    expect(REPORTS_PAGE_SIZE).toBe(5);
  });

  it('offers the default among the page-size choices', () => {
    expect(REPORTS_PAGE_SIZE_OPTIONS).toContain(REPORTS_PAGE_SIZE);
    expect(REPORTS_PAGE_SIZE_OPTIONS[0]).toBe(5);
  });
});

/**
 * The vulnerability chart's series contract.
 *
 * The chart previously shared a `stackId` across all four areas, so Recharts
 * plotted each series at the running total of the ones before it: a day reading
 * Low 0 drew its blue band at 2. There is no component test runner here, so
 * these assert the source of that bug directly — that no `stackId` survives and
 * that the four keys stay in their documented order and colours.
 */
describe('vulnerability trend chart contract', () => {
  // The chart is split across two files so Recharts stays out of the `/reports`
  // entry chunk: the card owns the header, legend and colour config, the body
  // owns the plot. Each assertion below has to read whichever file actually
  // holds the thing it guards — reading only one would leave the rest passing
  // vacuously against a file that no longer contains what they describe.
  const chartDir = join(import.meta.dir, '..', 'components', 'reports');
  const source = readFileSync(join(chartDir, 'vulnerability-trend-chart-body.tsx'), 'utf8');
  const cardSource = readFileSync(join(chartDir, 'vulnerability-trend-chart.tsx'), 'utf8');

  it('declares exactly the four severity series, most severe first', () => {
    expect(SERIES).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('paints least-severe first so Critical is never covered', () => {
    expect(PAINT_ORDER).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('paints every series the legend lists — no series silently dropped', () => {
    expect([...PAINT_ORDER].sort()).toEqual([...SERIES].sort());
  });

  it('uses no stackId — each area must plot its own value', () => {
    // Match the JSX prop form. The identifier still appears in the docblock
    // explaining why stacking was removed, and that prose must not fail this.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toMatch(/stackId\s*=/);
    expect(withoutComments).not.toContain('stackId');
  });

  it('does not use the `natural` curve, which can imply values that never occurred', () => {
    expect(source).not.toContain('type="natural"');
    expect(source).toContain('type="monotone"');
  });

  it('keeps the accessibility layer', () => {
    expect(source).toContain('accessibilityLayer');
  });

  it('binds each severity to its own colour token — Medium and Low not swapped', () => {
    // The colour config lives on the card, which resolves the tokens and passes
    // them down; the body receives them already resolved.
    const config = cardSource.slice(
      cardSource.indexOf('critical: { label'),
      cardSource.indexOf('}),\n    [colors]'),
    );
    expect(config).toContain("critical: { label: 'Critical', color: colors['severity-critical'] }");
    expect(config).toContain("high: { label: 'High', color: colors['severity-high'] }");
    expect(config).toContain("medium: { label: 'Medium', color: colors['severity-medium'] }");
    expect(config).toContain("low: { label: 'Low', color: colors['severity-low'] }");
  });

  it('gives each series its own gradient rather than reusing one fill', () => {
    // The gradient id is derived per series, so a single shared fill is
    // impossible: the defs are generated from SERIES and consumed by key.
    expect(source).toContain('id={`vuln-trend-${key}`}');
    expect(source).toContain('fill={`url(#vuln-trend-${key})`}');
  });
});
