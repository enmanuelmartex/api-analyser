import { describe, expect, it } from 'bun:test';
import { appBrand } from '../../brand/brand';
import {
  pdfFooterTemplate,
  pdfHeaderTemplate,
  renderReportHtml,
  sectionsFor,
} from './report-template';

/**
 * The report document's contract.
 *
 * Rendering is a pure string function, so the parts that matter — branding,
 * severity ordering, the evidence/AI separation, print-colour preservation —
 * are all assertable without launching Chromium.
 */

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    title: 'CORS Preflight Allows Dangerous HTTP Methods',
    severity: 'HIGH',
    cvssScore: 7.4,
    owaspCategory: 'API8:2023',
    cweId: 'CWE-942',
    pluginId: 'cors',
    description: 'The endpoint reflects arbitrary origins.',
    impact: 'An attacker-controlled origin can read authenticated responses.',
    remediation: 'Restrict Access-Control-Allow-Origin to an allowlist.',
    evidence: { header: 'Access-Control-Allow-Origin: *' },
    endpoint: { method: 'GET', path: '/api/v1/ai/config' },
    references: [] as string[],
    ...overrides,
  };
}

function assessment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-1',
    duration: 42,
    project: { name: 'Payments API', baseUrl: 'https://api.example.com', environment: 'PRODUCTION' },
    summary: {
      securityScore: 72,
      scoreStatus: 'FINAL',
      riskLevel: 'HIGH',
      totalFindings: 2,
      criticalCount: 0,
      highCount: 1,
      mediumCount: 1,
      lowCount: 0,
      infoCount: 0,
      testedEndpoints: 72,
      totalEndpoints: 72,
      successfulChecks: 38,
      plannedChecks: 38,
    },
    findings: [finding(), finding({ id: 'f2', severity: 'MEDIUM', title: 'Missing Cache-Control', cvssScore: 5.3 })],
    ...overrides,
  };
}

describe('branding', () => {
  const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });

  it('names the product', () => {
    expect(html).toContain(appBrand.name);
  });

  it('carries no trace of the previous brand', () => {
    expect(html).not.toMatch(/IASA/i);
  });

  it('embeds the logo as a data URI, not a URL Chromium would have to fetch', () => {
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).not.toContain('http://localhost');
  });

  it('loads no webfont, so generation cannot depend on outbound network', () => {
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('@font-face');
  });
});

describe('dark print styling', () => {
  const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });

  it('forces colour retention, without which Chromium prints the dark theme white', () => {
    expect(html).toContain('print-color-adjust: exact');
    expect(html).toContain('-webkit-print-color-adjust: exact');
  });

  it('uses the dark surface as the page background', () => {
    expect(html).toContain('background: #0a0a0a');
  });

  it('protects findings from being split across a page boundary', () => {
    expect(html).toContain('page-break-inside: avoid');
    expect(html).toContain('break-inside: avoid');
  });

  it('repeats table headers across pages', () => {
    expect(html).toContain('display: table-header-group');
  });

  it('keeps a section heading with the content that follows it', () => {
    expect(html).toContain('page-break-after: avoid');
  });
});

describe('content fidelity', () => {
  it('renders the stored snapshot score, not a recomputation', () => {
    const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });
    expect(html).toContain('72');
    expect(html).toContain('HIGH');
  });

  it('flags a provisional score on the face of the document', () => {
    const a = assessment();
    (a.summary as any).scoreStatus = 'PROVISIONAL';
    (a.summary as any).successfulChecks = 20;
    const html = renderReportHtml({ assessment: a, type: 'TECHNICAL' });
    expect(html).toContain('Provisional');
  });

  it('orders findings by severity, most severe first', () => {
    const a = assessment({
      findings: [
        finding({ id: 'low', severity: 'LOW', title: 'Low finding' }),
        finding({ id: 'crit', severity: 'CRITICAL', title: 'Critical finding' }),
        finding({ id: 'med', severity: 'MEDIUM', title: 'Medium finding' }),
      ],
    });
    const html = renderReportHtml({ assessment: a, type: 'TECHNICAL' });
    expect(html.indexOf('Critical finding')).toBeLessThan(html.indexOf('Medium finding'));
    expect(html.indexOf('Medium finding')).toBeLessThan(html.indexOf('Low finding'));
  });

  it('states an empty result rather than rendering an empty findings section', () => {
    const html = renderReportHtml({ assessment: assessment({ findings: [] }), type: 'TECHNICAL' });
    expect(html).toContain('No findings were recorded');
  });

  it('titles the OWASP table for what it counts', () => {
    const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });
    // "Coverage" over a table of finding counts overstates what was measured.
    expect(html).toContain('Findings by OWASP category');
    expect(html).not.toContain('OWASP API Top 10 Coverage');
  });

  it('omits a block entirely when its data is absent, rather than padding it', () => {
    const html = renderReportHtml({
      assessment: assessment({ findings: [finding({ remediation: null, impact: null })] }),
      type: 'TECHNICAL',
    });
    expect(html).not.toContain('>Remediation<');
    expect(html).not.toContain('>Impact<');
  });

  it('escapes finding content so a hostile title cannot inject markup', () => {
    const html = renderReportHtml({
      assessment: assessment({ findings: [finding({ title: '<script>alert(1)</script>' })] }),
      type: 'TECHNICAL',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('evidence and AI separation', () => {
  const withAi = assessment({
    findings: [
      finding({
        aiAnalysis: {
          technicalAnalysis: 'Model-written analysis.',
          businessImpact: 'Model-written impact.',
        },
      }),
    ],
  });

  it('labels model output as guidance, distinct from observed evidence', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    expect(html).toContain('AI-assisted guidance');
  });

  it('never presents model output under the Evidence heading', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    const evidenceIdx = html.indexOf('>Evidence<');
    const aiIdx = html.indexOf('AI-assisted guidance');
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(evidenceIdx);
  });

  it('avoids promotional AI framing', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    for (const phrase of ['Powered by AI', 'artificial intelligence', 'AI magic', 'Smart analysis']) {
      expect(html.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});

describe('report types are different documents', () => {
  it('withholds packet-level evidence from the executive report', () => {
    expect(sectionsFor('EXECUTIVE').evidence).toBe(false);
    const html = renderReportHtml({ assessment: assessment(), type: 'EXECUTIVE' });
    expect(html).toContain('Executive Summary');
    expect(html).not.toContain('>Evidence<');
  });

  it('gives the technical report full evidence and methodology', () => {
    const s = sectionsFor('TECHNICAL');
    expect(s.evidence).toBe(true);
    expect(s.methodology).toBe(true);
  });

  it('gives the developer report reproduction guidance and no OWASP roll-up', () => {
    const s = sectionsFor('DEVELOPER');
    expect(s.reproduction).toBe(true);
    expect(s.owasp).toBe(false);
  });

  it('keeps category coverage central to the compliance report', () => {
    const s = sectionsFor('COMPLIANCE');
    expect(s.owasp).toBe(true);
    expect(s.methodology).toBe(true);
  });

  it('caps detailed findings in the executive report and summarises the rest', () => {
    const many = assessment({
      findings: Array.from({ length: 14 }, (_, i) =>
        finding({ id: `f${i}`, severity: 'LOW', title: `Finding ${i}` }),
      ),
      summary: { ...assessment().summary, totalFindings: 14 },
    });
    const html = renderReportHtml({ assessment: many, type: 'EXECUTIVE' });
    expect(html).toContain('Additional findings');
  });

  it('all four types render without throwing', () => {
    for (const type of ['TECHNICAL', 'EXECUTIVE', 'DEVELOPER', 'COMPLIANCE'] as const) {
      expect(() => renderReportHtml({ assessment: assessment(), type })).not.toThrow();
    }
  });
});

describe('page furniture', () => {
  it('numbers pages using Chromium substitution, not CSS counters', () => {
    const footer = pdfFooterTemplate('cms3e3e270005h0eg');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('marks the document confidential and names the domain', () => {
    const footer = pdfFooterTemplate();
    expect(footer).toContain('Confidential');
    expect(footer).toContain(appBrand.domain);
  });

  it('truncates the report id in the footer rather than printing it whole', () => {
    const footer = pdfFooterTemplate('cms3e3e270005h0egzjonwlde');
    expect(footer).toContain('cms3e3e2');
    expect(footer).not.toContain('cms3e3e270005h0egzjonwlde');
  });

  it('brands the running header', () => {
    expect(pdfHeaderTemplate()).toContain(appBrand.name);
  });
});
