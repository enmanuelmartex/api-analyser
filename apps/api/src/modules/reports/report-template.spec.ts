import { describe, expect, it } from 'bun:test';
import { appBrand } from '../../brand/brand';
import { markDataUri } from '../../brand/brand-assets';
import { computeOwaspCoverage } from '../plugins/owasp-coverage';
import { createBuiltinPlugins } from '../plugins/plugin-registry.service';
import { renderReportHtml, sectionsFor } from './report-template';

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

  it('draws the mark for the surface it sits on, dark cover and paper alike', () => {
    // The regression this guards: one file for both surfaces meant the cover
    // carried artwork drawn in ink on a near-black background, and a `data:`
    // URI cannot inherit `currentColor` to rescue it.
    const cover = markDataUri('dark');
    const page = markDataUri('light');
    expect(html).toContain(`class="cover-mark" src="${cover}"`);
    expect(html).toContain(`class="ph-mark" src="${page}"`);
    expect(cover).not.toBe(page);
  });

  it('loads no webfont, so generation cannot depend on outbound network', () => {
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('@font-face');
  });
});

describe('print styling', () => {
  const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });

  it('forces colour retention, without which Chromium prints the dark cover white', () => {
    expect(html).toContain('print-color-adjust: exact');
    expect(html).toContain('-webkit-print-color-adjust: exact');
  });

  it('gives the cover the brand Canvas', () => {
    // #08080A is Canvas from `branding/README.md` — the same surface the
    // application shell paints, so a printed cover and the dashboard behind it
    // are the same black.
    expect(html).toContain('background: #08080A');
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

describe('severity palette', () => {
  /*
   * Severity rank has to be readable before a word is: red, orange, amber,
   * blue, slate. The previous set was darkened for print contrast, which pulled
   * high and medium into two near-identical browns — the one distinction that
   * matters most was the one that was lost.
   */
  const html = renderReportHtml({
    assessment: assessment({
      findings: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map((severity, i) =>
        finding({ id: `f${i}`, severity, title: `${severity} finding` }),
      ),
    }),
    type: 'TECHNICAL',
  });

  const PALETTE = {
    CRITICAL: '#DC2626',
    HIGH: '#F97316',
    MEDIUM: '#F59E0B',
    LOW: '#3B82F6',
    INFO: '#64748B',
  };

  it('renders every severity in its conventional hue', () => {
    for (const colour of Object.values(PALETTE)) expect(html).toContain(colour);
  });

  it('keeps no trace of the brown-and-green set it replaced', () => {
    // Brown high/medium, and a green low that read as "passed" rather than
    // "low-severity vulnerability".
    for (const retired of ['#a5510a', '#7d5a05', '#a8121a', '#0c6091', '#22c55e']) {
      expect(html).not.toContain(retired);
    }
  });

  it('separates high from medium, which is the distinction most often collapsed', () => {
    expect(PALETTE.HIGH).not.toBe(PALETTE.MEDIUM);
    expect(html).toContain(PALETTE.HIGH);
    expect(html).toContain(PALETTE.MEDIUM);
  });

  it('carries the severity colour on the accent rule of a finding, not only its badge', () => {
    expect(html).toContain(`border-left-color:${PALETTE.CRITICAL}`);
    expect(html).toContain(`border-top-color:${PALETTE.HIGH}`);
  });

  it('uses the severity colour for the chart segments and legend swatches', () => {
    expect(html).toContain(`stroke="${PALETTE.MEDIUM}"`);
    expect(html).toContain(`background:${PALETTE.LOW}`);
  });

  it('labels a filled badge in whichever of white or near-black clears contrast', () => {
    // Orange and amber cannot be set as 6.5pt type; darkening them enough to
    // read turns both brown. The fill carries the hue and the label stays legible.
    expect(html).toContain(`color:#ffffff;background:${PALETTE.CRITICAL}`);
    expect(html).toContain(`color:#1f2937;background:${PALETTE.HIGH}`);
    expect(html).toContain(`color:#1f2937;background:${PALETTE.MEDIUM}`);
  });
});

describe('document architecture', () => {
  /*
   * These guard the failure this layout was rebuilt to fix: the report used to
   * be one continuous dark column printed inside Chromium's paper margin, so
   * every page rendered as a dark rectangle floating on a white sheet with no
   * composition of its own. Pages are now real objects the document owns.
   */
  const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });

  it('claims the whole sheet, leaving no paper margin to frame the cover in white', () => {
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
  });

  it('composes pages at A4 dimensions rather than letting content flow to any height', () => {
    expect(html).toContain('width: 210mm');
    expect(html).toContain('height: 297mm');
  });

  it('keeps the dark surface on the cover only, so interior pages print on paper', () => {
    const coverStart = html.indexOf('sheet-cover');
    const flowStart = html.indexOf('data-anchor="exec"');
    expect(coverStart).toBeGreaterThan(-1);
    expect(coverStart).toBeLessThan(flowStart);
    // Interior sheets inherit the paper background, never the cover's.
    expect(html).toContain('.sheet {');
    expect(html).toMatch(/\.sheet \{[^}]*background: #ffffff/);
  });

  it('starts every numbered section on a page of its own', () => {
    const starts = html.match(/data-start="page"/g) ?? [];
    // Five sections plus the contents page for a technical report with coverage.
    expect(starts.length).toBeGreaterThanOrEqual(5);
  });

  it('ships the paginator with the document, so a stored snapshot re-prints identically', () => {
    expect(html).toContain('report-source');
    expect(html).toContain('report-furniture');
    expect(html).toContain('data-paginated');
  });

  it('declares how oversized blocks break, rather than letting them be clipped', () => {
    expect(html).toContain('data-split="children"');
    expect(html).toContain('data-split="rows"');
  });

  it('lists the sections in a contents page whose page numbers the paginator resolves', () => {
    expect(html).toContain('>Contents<');
    expect(html).toContain('data-toc-page="exec"');
    expect(html).toContain('data-toc-page="detail"');
  });
});

describe('page furniture', () => {
  /*
   * Running furniture lives in the document, not in Chromium's header/footer
   * templates: those can only draw inside a paper margin, and this document has
   * none. Keeping it in the HTML also means a re-print of an archived snapshot
   * carries the same footer as the original.
   */
  const html = renderReportHtml({
    assessment: assessment(),
    type: 'TECHNICAL',
    reportId: 'cms3e3e270005h0egzjonwlde',
    version: 3,
  });

  it('numbers pages in the document, since CSS counters do not work in Chromium print', () => {
    expect(html).toContain('class="pf-n"');
    expect(html).toContain('class="pf-t"');
  });

  it('marks the document confidential and names the domain', () => {
    expect(html).toContain('Confidential');
    expect(html).toContain(appBrand.domain);
  });

  it('truncates the report id in the footer rather than printing it whole', () => {
    expect(html).toContain('cms3e3e2');
    expect(html).not.toContain('cms3e3e270005h0egzjonwlde');
  });

  it('falls back to the assessment id when no report id is known yet', () => {
    const withoutReportId = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });
    expect(withoutReportId).toContain('class="pf-ref">scan-1<');
  });

  it('brands the running header and names the document beside it', () => {
    expect(html).toContain('class="ph-brand"');
    expect(html).toContain(appBrand.name);
  });

  it('carries the artifact version so a reader can tell two revisions apart', () => {
    expect(html).toContain('v3');
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

  it('counts the findings it renders when a legacy summary is stale', () => {
    const legacy = assessment({
      summary: {
        ...assessment().summary,
        totalFindings: 14,
        highCount: 14,
        mediumCount: 0,
      },
    });
    const html = renderReportHtml({ assessment: legacy, type: 'TECHNICAL' });

    expect(html).toMatch(/<div class="fig-k">Findings<\/div>\s*<div class="fig-v">2<\/div>/);
    expect(html).toContain('<span class="legend-v">1</span>');
    expect(html).not.toContain('<span class="legend-v">14</span>');
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

  it('prints CVSS to one decimal, so float noise cannot overflow the column', () => {
    const html = renderReportHtml({
      assessment: assessment({ findings: [finding({ cvssScore: 3.0999999999999996 })] }),
      type: 'TECHNICAL',
    });
    expect(html).toContain('3.1');
    expect(html).not.toContain('3.0999999999999996');
  });

  it('wraps long paths at their own separators rather than mid-segment', () => {
    const html = renderReportHtml({
      assessment: assessment({
        findings: [finding({ endpoint: { method: 'POST', path: '/api/v1/resources/42/sub-resource' } })],
      }),
      type: 'TECHNICAL',
    });
    // A zero-width space after each separator gives the browser somewhere legal
    // to break; it prints as nothing.
    const zeroWidthSpace = '\u200B';
        expect(html).toContain(`/${zeroWidthSpace}api/${zeroWidthSpace}v1`);
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
  /*
   * Guidance now arrives as the validated `SecurityGuidance` payload persisted
   * on the issue, not as the free-form `aiAnalysis` blob that lived only in
   * memory during a scan. The separation these tests protect is unchanged: the
   * model's words must be labelled and must never appear under Evidence.
   */
  const withAi = assessment({
    findings: [
      finding({
        guidance: {
          summary: 'Model-written summary.',
          rootCause: 'Model-written root cause.',
          businessImpact: 'Model-written impact.',
          remediation: { priority: 'SHORT_TERM', steps: [{ title: 'Add an allowlist', description: '' }] },
          verification: { steps: ['Re-run the check'], expectedResult: 'No finding' },
          falsePositiveConsiderations: [],
          environmentGuidance: [],
          references: [],
          confidence: 0.8,
          _meta: {
            provider: 'claude',
            model: 'claude-sonnet-5',
            promptVersion: 'guidance-prompt-v3',
            knowledgeVersion: 'knowledge-2026.08.1',
            confidence: 0.8,
            generatedAt: new Date('2026-08-08'),
          },
        },
      }),
    ],
  });

  const AI_LABEL = 'AI security guidance';

  it('labels model output as guidance, distinct from observed evidence', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    expect(html).toContain(AI_LABEL);
    expect(html).toContain('advisory, not scanner evidence');
    expect(html).toContain('Model-written summary.');
  });

  it('says so when it shortens evidence, rather than clipping it silently', () => {
    /*
     * A fixed-page document has to bound an unbounded evidence dump somewhere.
     * Bounding it by CSS clipping would show a reader a truncated packet trace
     * with nothing to indicate that is what they are looking at.
     */
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const html = renderReportHtml({
      assessment: assessment({ findings: [finding({ evidence: long })] }),
      type: 'TECHNICAL',
    });

    expect(html).toContain('line 0');
    expect(html).not.toContain('line 399');
    expect(html).toContain('Truncated for print');
    expect(html).toContain('further lines omitted');
    // Points at the exports that do carry the whole record.
    expect(html).toContain('JSON and SARIF exports');
  });

  it('leaves short evidence untouched and unannotated', () => {
    const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });
    expect(html).not.toContain('Truncated for print');
  });

  it('never presents model output under the Evidence heading', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    const evidenceIdx = html.indexOf('>Evidence<');
    const aiIdx = html.indexOf(AI_LABEL);
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(evidenceIdx);
  });

  it('records which model, prompt and knowledge pack produced the guidance', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    expect(html).toContain('guidance-prompt-v3');
    expect(html).toContain('knowledge-2026.08.1');
  });

  it('omits the guidance block entirely when there is none', () => {
    const html = renderReportHtml({ assessment: assessment(), type: 'TECHNICAL' });
    expect(html).not.toContain(AI_LABEL);
  });

  it('avoids promotional AI framing', () => {
    const html = renderReportHtml({ assessment: withAi, type: 'TECHNICAL' });
    for (const phrase of ['Powered by AI', 'artificial intelligence', 'AI magic', 'Smart analysis']) {
      expect(html.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});

describe('OWASP coverage section', () => {
  /*
   * A compliance reader must be able to tell "tested and clean" from "never
   * tested". The report previously had only a findings-per-category table,
   * which listed just the categories where something was found — so API6, API9
   * and API10, which then had no check behind them, were absent from the
   * document entirely and read as unproblematic.
   */
  const coverage = computeOwaspCoverage(createBuiltinPlugins().map((p) => p.manifest));
  const withCoverage = assessment({ owaspCoverage: coverage });

  /**
   * A registry that covers only part of the edition.
   *
   * The shipped registry covers all ten categories, so the "not covered"
   * rendering has nothing to render against it. That rendering is the one that
   * matters most — it is what keeps an untested category from reading as a
   * clean one — so it is exercised against a deliberately partial registry
   * rather than deleted along with the gap it described.
   */
  const partial = computeOwaspCoverage(
    createBuiltinPlugins()
      .map((p) => p.manifest)
      .filter((m) => !m.owaspMappings.includes('API6:2023')),
  );

  it('lists all ten categories, not only the ones with findings', () => {
    const html = renderReportHtml({ assessment: withCoverage, type: 'COMPLIANCE' });

    for (const category of coverage.categories) {
      expect(html).toContain(category.title);
    }
  });

  it('marks uncovered categories as not covered and explains why', () => {
    const html = renderReportHtml({
      assessment: assessment({ owaspCoverage: partial }),
      type: 'COMPLIANCE',
    });

    expect(html).toContain('Not covered');
    // The gap reason must travel with the row; "not covered" alone reads as an
    // oversight rather than a deliberate limit.
    const api6 = partial.categories.find((c) => c.id === 'API6:2023')!;
    expect(html).toContain(api6.gapReason!.slice(0, 40));
  });

  it('states the coverage ratio the manifests actually produce', () => {
    const html = renderReportHtml({ assessment: withCoverage, type: 'COMPLIANCE' });

    expect(html).toContain(coverage.label);
    // "Full coverage" is a claim about results, not about checks, and no
    // arrangement of the registry may make the report say it.
    expect(html.toLowerCase()).not.toContain('full coverage');
  });

  it('qualifies a covered category whose checks cannot see the whole of it', () => {
    const html = renderReportHtml({ assessment: withCoverage, type: 'COMPLIANCE' });
    const api10 = coverage.categories.find((c) => c.id === 'API10:2023')!;

    // Covered, and the row still says what the check could not reach — the
    // sentence that stops "10/10" from being read as "exhaustively tested".
    expect(api10.scopeNote).toBeTruthy();
    expect(html).toContain(api10.scopeNote!.slice(0, 40));
  });

  it('warns that an absence of findings in an uncovered category proves nothing', () => {
    const html = renderReportHtml({
      assessment: assessment({ owaspCoverage: partial }),
      type: 'COMPLIANCE',
    });
    // Whitespace-insensitive: the sentence wraps across lines in the template,
    // and reflowing the source must not fail this assertion.
    const flattened = html.replace(/\s+/g, ' ');
    expect(flattened).toContain('not evidence that the API is secure');
  });

  it('omits the section when coverage was not supplied, rather than inventing it', () => {
    const html = renderReportHtml({ assessment: assessment(), type: 'COMPLIANCE' });
    expect(html).not.toContain('OWASP API Security Top 10 coverage');
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

