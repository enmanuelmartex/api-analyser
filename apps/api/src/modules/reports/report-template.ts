import { appBrand } from '../../brand/brand';
import { logoDataUri } from '../../brand/brand-assets';

/**
 * The report document: one dark, print-ready HTML template shared by the PDF
 * and HTML formats.
 *
 * The previous template was a white A4 page with pastel severity chips — it
 * read as a different product from the application it came out of. This one
 * uses the app's own surfaces and severity colours so an exported report is
 * recognisably the same tool.
 *
 * Print correctness is the constraint that shapes most of the CSS:
 *   • `print-color-adjust: exact` — without it Chromium drops every background,
 *     and a dark document prints as black text on white with invisible chips.
 *   • No webfonts. A `@font-face` pointing at Google Fonts makes report
 *     generation depend on outbound network access, which fails in a locked-down
 *     container and silently reflows the document. A system stack is used.
 *   • Page numbers come from Chromium's own header/footer templates, not CSS
 *     counters, which do not work in print in Chromium.
 */

export type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};

/** Severity palette, matched to the application's `--severity-*` tokens. */
const SEVERITY: Record<string, { color: string; label: string }> = {
  CRITICAL: { color: '#f2555a', label: 'Critical' },
  HIGH:     { color: '#fb923c', label: 'High' },
  MEDIUM:   { color: '#facc15', label: 'Medium' },
  LOW:      { color: '#38bdf8', label: 'Low' },
  INFO:     { color: '#94a3b8', label: 'Info' },
};

const T = {
  bg: '#0a0a0a',
  surface: '#161616',
  elevated: '#1f1f1f',
  border: '#2b2b2b',
  borderSoft: '#232323',
  text: '#f5f5f5',
  muted: '#a3a3a3',
  faint: '#6b6b6b',
  accent: '#4D9DFF',
  accentAlt: '#7C5CFF',
};

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Which sections each report type carries.
 *
 * The four types are genuinely different documents, not one document with a
 * different cover: an executive summary that dumps raw HTTP evidence is not an
 * executive summary. Only the shared visual system is common.
 */
interface Sections {
  /** Full technical detail per finding: evidence, request/response, CVSS vector. */
  evidence: boolean;
  /** Description / impact / remediation prose. */
  narrative: boolean;
  /** Reproduction and verification guidance aimed at the engineer fixing it. */
  reproduction: boolean;
  /** OWASP category breakdown. */
  owasp: boolean;
  /** Scan configuration and plugin execution appendix. */
  methodology: boolean;
  /** Cap on findings rendered in full; the rest are listed compactly. */
  detailedFindingLimit: number | null;
  subtitle: string;
}

export function sectionsFor(type: ReportType): Sections {
  switch (type) {
    case 'EXECUTIVE':
      // Posture and priorities. Impact prose is kept; packet-level evidence is not.
      return { evidence: false, narrative: true, reproduction: false, owasp: true,
               methodology: false, detailedFindingLimit: 10, subtitle: 'Executive Summary' };
    case 'COMPLIANCE':
      // Category coverage and gaps carry the document; findings are the support.
      return { evidence: false, narrative: true, reproduction: false, owasp: true,
               methodology: true, detailedFindingLimit: null, subtitle: 'Compliance Report' };
    case 'DEVELOPER':
      // Everything needed to reproduce and fix, without executive framing.
      return { evidence: true, narrative: true, reproduction: true, owasp: false,
               methodology: false, detailedFindingLimit: null, subtitle: 'Developer Report' };
    case 'TECHNICAL':
    default:
      return { evidence: true, narrative: true, reproduction: false, owasp: true,
               methodology: true, detailedFindingLimit: null, subtitle: 'Technical Security Report' };
  }
}

function scoreColor(score: number | null): string {
  if (score === null) return T.faint;
  if (score >= 80) return '#4ade80';
  if (score >= 60) return '#facc15';
  if (score >= 40) return '#fb923c';
  return '#f2555a';
}

function severityBadge(severity: string): string {
  const s = SEVERITY[severity] ?? SEVERITY.INFO;
  return `<span class="sev" style="color:${s.color};border-color:${s.color}55;background:${s.color}1a">${esc(s.label.toUpperCase())}</span>`;
}

function metric(label: string, value: string, color?: string): string {
  return `<div class="metric">
    <div class="metric-label">${esc(label)}</div>
    <div class="metric-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
  </div>`;
}

/** A labelled prose block inside a finding. Omitted entirely when empty. */
function block(label: string, body: string | null | undefined, cls = ''): string {
  if (!body) return '';
  return `<div class="block ${cls}">
    <div class="block-label">${esc(label)}</div>
    <div class="block-body">${esc(body)}</div>
  </div>`;
}

/** Evidence rendered as preformatted text, never as prose. */
function evidenceBlock(label: string, body: unknown): string {
  if (body === null || body === undefined || body === '') return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return `<div class="block">
    <div class="block-label">${esc(label)}</div>
    <pre class="evidence">${esc(text)}</pre>
  </div>`;
}

export interface TemplateInput {
  assessment: any;
  type: ReportType;
  /** Report id, shown truncated in the footer for traceability. */
  reportId?: string;
  version?: number;
}

export function renderReportHtml({ assessment, type, reportId, version }: TemplateInput): string {
  const { project, summary, findings } = assessment;
  const sections = sectionsFor(type);
  const logo = logoDataUri();

  const generatedAt = new Date();
  const dateLong = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Read from the stored snapshot, never recomputed — a report must not change
  // because issues were re-triaged after it was issued.
  const score: number | null = summary?.securityScore ?? null;
  const scoreStatus = summary?.scoreStatus ?? 'UNAVAILABLE';

  const scoreCaveat =
    scoreStatus === 'FINAL'
      ? ''
      : scoreStatus === 'PROVISIONAL'
        ? `Provisional — ${summary?.successfulChecks ?? 0} of ${summary?.plannedChecks ?? 0} checks completed` +
          (summary?.coveragePercent != null ? ` · ${summary.coveragePercent}% coverage` : '')
        : 'No score could be computed for this scan';

  const sorted = [...(findings ?? [])].sort((a: any, b: any) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    return (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
  });

  const detailed = sections.detailedFindingLimit === null
    ? sorted
    : sorted.slice(0, sections.detailedFindingLimit);
  const remainder = sorted.slice(detailed.length);

  // ── Findings by OWASP category ────────────────────────────────────────────
  // Named for what it counts. The old heading said "OWASP API Top 10 Coverage"
  // over a table of finding counts, which implies checks executed per category
  // — a different and more flattering claim than "these are the categories the
  // findings fell into".
  const owaspCounts: Record<string, number> = {};
  for (const f of sorted) {
    if (f.owaspCategory) owaspCounts[f.owaspCategory] = (owaspCounts[f.owaspCategory] ?? 0) + 1;
  }
  const owaspRows = Object.entries(owaspCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `<tr><td>${esc(cat)}</td><td class="num">${count}</td></tr>`)
    .join('');

  const severityCells = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
    .map((key) => {
      const count = summary?.[`${key.toLowerCase()}Count`] ?? 0;
      const s = SEVERITY[key];
      return `<div class="sev-cell" style="border-color:${s.color}33">
        <div class="sev-count" style="color:${s.color}">${count}</div>
        <div class="sev-name">${s.label}</div>
      </div>`;
    })
    .join('');

  const findingSections = detailed.map((f: any, index: number) => {
    const s = SEVERITY[f.severity] ?? SEVERITY.INFO;
    const endpoint = f.endpoint?.path
      ? `${esc(f.endpoint.method ?? '')} ${esc(f.endpoint.path)}`.trim()
      : f.affectedUrl ? esc(f.affectedUrl) : '';

    const meta = [
      f.owaspCategory ? `OWASP ${esc(f.owaspCategory)}` : '',
      f.cweId ? `CWE ${esc(f.cweId)}` : '',
      f.pluginId ? `${esc(f.pluginId)} check` : '',
    ].filter(Boolean).join('<span class="dot">·</span>');

    /*
     * AI output is walled off from scanner evidence.
     *
     * Everything above this block was observed by a check. The guidance below
     * was written by a language model from that observation, and is labelled as
     * such with no promotional framing — a reader must never mistake generated
     * prose for something the scanner saw.
     */
    const ai = f.aiAnalysis && sections.narrative
      ? `<div class="ai">
          <div class="ai-label">AI-assisted guidance</div>
          ${f.aiAnalysis.technicalAnalysis ? `<p>${esc(f.aiAnalysis.technicalAnalysis)}</p>` : ''}
          ${f.aiAnalysis.businessImpact ? `<p><span class="ai-sub">Business impact.</span> ${esc(f.aiAnalysis.businessImpact)}</p>` : ''}
          ${Array.isArray(f.aiAnalysis.securityBestPractices) && f.aiAnalysis.securityBestPractices.length
            ? `<p class="ai-sub">Recommended practices</p><ul>${f.aiAnalysis.securityBestPractices.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          ${Array.isArray(f.aiAnalysis.validationSteps) && f.aiAnalysis.validationSteps.length
            ? `<p class="ai-sub">Validation steps</p><ul>${f.aiAnalysis.validationSteps.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        </div>` : '';

    return `<section class="finding">
      <div class="finding-head" style="border-left-color:${s.color}">
        <div class="finding-title-row">
          ${severityBadge(f.severity)}
          <h3 class="finding-title">${esc(f.title)}</h3>
          ${f.cvssScore != null ? `<span class="cvss">CVSS ${esc(f.cvssScore)}</span>` : ''}
        </div>
        ${endpoint ? `<div class="finding-endpoint">${endpoint}</div>` : ''}
        ${meta ? `<div class="finding-meta">${meta}</div>` : ''}
      </div>

      ${sections.narrative ? block('Description', f.description) : ''}
      ${sections.evidence ? evidenceBlock('Evidence', f.evidence) : ''}
      ${sections.evidence && f.httpRequest ? evidenceBlock('Request (redacted)', f.httpRequest) : ''}
      ${sections.evidence && f.httpResponse ? evidenceBlock('Response (redacted)', f.httpResponse) : ''}
      ${sections.narrative ? block('Impact', f.impact) : ''}
      ${sections.narrative ? block('Remediation', f.remediation, 'remediation') : ''}
      ${sections.reproduction && f.endpoint?.path
        ? block('Verification', `Re-run the ${f.pluginId ?? 'relevant'} check against ${f.endpoint.method ?? ''} ${f.endpoint.path} and confirm the finding no longer reproduces.`)
        : ''}
      ${ai}
      ${f.references?.length
        ? `<div class="block"><div class="block-label">References</div><ul class="refs">${f.references.map((r: string) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
        : ''}
    </section>`;
  }).join('');

  const remainderTable = remainder.length
    ? `<h2 class="section-title">Additional findings</h2>
       <p class="section-note">${remainder.length} further finding${remainder.length === 1 ? '' : 's'} of lower priority, listed for completeness. Full detail is available in the technical report.</p>
       <table class="table">
         <thead><tr><th>Severity</th><th>Finding</th><th>Endpoint</th></tr></thead>
         <tbody>${remainder.map((f: any) => `<tr>
           <td>${severityBadge(f.severity)}</td>
           <td>${esc(f.title)}</td>
           <td class="mono">${esc(f.endpoint?.path ?? f.affectedUrl ?? '—')}</td>
         </tr>`).join('')}</tbody>
       </table>`
    : '';

  const plugins = summary?.pluginResults;
  const methodology = sections.methodology && plugins
    ? `<h2 class="section-title">Scan configuration</h2>
       <table class="table">
         <tbody>
           <tr><td>Checks executed</td><td class="num">${plugins.executed?.length ?? 0}</td></tr>
           <tr><td>Checks skipped</td><td class="num">${plugins.skipped?.length ?? 0}</td></tr>
           <tr><td>Checks failed</td><td class="num">${plugins.failed?.length ?? 0}</td></tr>
           ${plugins.executed?.length ? `<tr><td>Executed</td><td class="mono">${esc(plugins.executed.join(', '))}</td></tr>` : ''}
           ${plugins.skipped?.length ? `<tr><td>Skipped</td><td class="mono">${esc(plugins.skipped.join(', '))}</td></tr>` : ''}
         </tbody>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(appBrand.name)} ${esc(sections.subtitle)} — ${esc(project?.name ?? '')}</title>
<style>
  /* Preserve dark surfaces in print. Without this Chromium strips every
     background and the document prints as unstyled black-on-white. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; margin: 0; padding: 0; }

  @page { size: A4; margin: 16mm 14mm; }

  html, body {
    background: ${T.bg};
    color: ${T.text};
    /* System stack only — no network fetch during PDF generation. */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
  }
  .mono, code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }

  /* ── Cover ─────────────────────────────────────────────────────────────── */
  .cover { padding: 8mm 0 10mm; border-bottom: 1px solid ${T.border}; margin-bottom: 9mm; }
  .cover-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 14mm; }
  .cover-brand img { width: 34px; height: 34px; }
  .cover-brand .name { font-size: 15pt; font-weight: 600; letter-spacing: -0.01em; }
  .cover-kicker { color: ${T.accent}; font-size: 8.5pt; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4mm; }
  .cover h1 { font-size: 25pt; font-weight: 650; letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 3mm; }
  .cover .project { font-size: 12pt; color: ${T.text}; margin-bottom: 1mm; }
  .cover .target { color: ${T.muted}; font-size: 9.5pt; }

  .cover-facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 9mm; }
  .fact { background: ${T.surface}; border: 1px solid ${T.borderSoft}; border-radius: 6px; padding: 4mm; }
  .fact-label { color: ${T.faint}; font-size: 7.5pt; letter-spacing: 0.1em; text-transform: uppercase; }
  .fact-value { font-size: 12pt; font-weight: 600; margin-top: 1.5mm; }

  .caveat { margin-top: 5mm; padding: 3mm 4mm; border-radius: 5px;
            border: 1px solid #fb923c44; background: #fb923c14; color: #fdba74; font-size: 9pt; }

  /* ── Sections ──────────────────────────────────────────────────────────── */
  .section-title { font-size: 13pt; font-weight: 600; letter-spacing: -0.01em;
                   margin: 9mm 0 3mm; padding-bottom: 2mm; border-bottom: 1px solid ${T.border};
                   break-after: avoid; page-break-after: avoid; }
  .section-note { color: ${T.muted}; font-size: 9pt; margin-bottom: 3mm; }

  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
  .metric { background: ${T.surface}; border: 1px solid ${T.borderSoft}; border-radius: 6px; padding: 3.5mm 4mm; }
  .metric-label { color: ${T.faint}; font-size: 7.5pt; letter-spacing: 0.09em; text-transform: uppercase; }
  .metric-value { font-size: 14pt; font-weight: 600; margin-top: 1mm; font-variant-numeric: tabular-nums; }

  .sev-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; margin-top: 3mm; }
  .sev-cell { background: ${T.surface}; border: 1px solid; border-radius: 6px; padding: 3.5mm 2mm; text-align: center; }
  .sev-count { font-size: 17pt; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .sev-name { color: ${T.muted}; font-size: 8pt; margin-top: 1mm; }

  /* ── Tables ────────────────────────────────────────────────────────────── */
  .table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .table thead { display: table-header-group; }  /* repeat header across pages */
  .table th { text-align: left; color: ${T.faint}; font-size: 7.5pt; letter-spacing: 0.09em;
              text-transform: uppercase; font-weight: 600; padding: 2.5mm 3mm;
              border-bottom: 1px solid ${T.border}; background: ${T.surface}; }
  .table td { padding: 2.5mm 3mm; border-bottom: 1px solid ${T.borderSoft}; vertical-align: top; }
  .table tr { break-inside: avoid; page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Findings ──────────────────────────────────────────────────────────── */
  .finding {
    background: ${T.surface}; border: 1px solid ${T.borderSoft}; border-radius: 7px;
    padding: 4mm 4.5mm; margin-bottom: 4mm;
    /* Keep a finding whole where it fits on one page. Long ones are allowed to
       split rather than leaving a half-empty page, but never at the head. */
    break-inside: avoid; page-break-inside: avoid;
  }
  .finding-head { border-left: 2.5px solid; padding-left: 3.5mm; margin-bottom: 3mm;
                  break-after: avoid; page-break-after: avoid; }
  .finding-title-row { display: flex; align-items: baseline; gap: 2.5mm; flex-wrap: wrap; }
  .finding-title { font-size: 11pt; font-weight: 600; flex: 1; letter-spacing: -0.01em; }
  .sev { font-size: 7pt; font-weight: 700; letter-spacing: 0.09em; padding: 1px 6px;
         border-radius: 3px; border: 1px solid; white-space: nowrap; }
  .cvss { font-size: 8.5pt; color: ${T.muted}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .finding-endpoint { font-family: "SFMono-Regular", Consolas, monospace; font-size: 9pt;
                      color: ${T.accent}; margin-top: 1.5mm; }
  .finding-meta { color: ${T.faint}; font-size: 8.5pt; margin-top: 1mm; }
  .dot { padding: 0 6px; color: ${T.border}; }

  .block { margin-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
  .block-label { color: ${T.faint}; font-size: 7.5pt; letter-spacing: 0.09em;
                 text-transform: uppercase; font-weight: 600; margin-bottom: 1mm; }
  .block-body { color: #d6d6d6; font-size: 9.5pt; }
  .remediation .block-body { color: #86efac; background: #22c55e10; border-left: 2px solid #22c55e66;
                             padding: 2.5mm 3mm; border-radius: 0 4px 4px 0; }
  .evidence { background: ${T.bg}; border: 1px solid ${T.border}; border-radius: 4px;
              padding: 2.5mm 3mm; font-size: 8pt; color: #c9c9c9; white-space: pre-wrap;
              word-break: break-word; max-height: 90mm; overflow: hidden; }
  .refs { padding-left: 4mm; font-size: 8.5pt; color: ${T.muted}; }

  /* AI guidance is visually subordinate to observed evidence. */
  .ai { margin-top: 3mm; padding: 3mm 3.5mm; border-radius: 5px;
        border: 1px solid ${T.border}; background: ${T.elevated};
        break-inside: avoid; page-break-inside: avoid; }
  .ai-label { color: ${T.accentAlt}; font-size: 7.5pt; letter-spacing: 0.09em;
              text-transform: uppercase; font-weight: 600; margin-bottom: 1.5mm; }
  .ai p { font-size: 9pt; color: #c9c9c9; margin-bottom: 1.5mm; }
  .ai ul { padding-left: 4mm; font-size: 9pt; color: #c9c9c9; margin-bottom: 1.5mm; }
  .ai-sub { color: ${T.muted}; font-weight: 600; }

  .empty { color: ${T.muted}; text-align: center; padding: 8mm; background: ${T.surface};
           border: 1px solid ${T.borderSoft}; border-radius: 6px; font-size: 9.5pt; }
</style>
</head>
<body>

  <header class="cover">
    <div class="cover-brand">
      ${logo ? `<img src="${logo}" alt="">` : ''}
      <span class="name">${esc(appBrand.name)}</span>
    </div>

    <div class="cover-kicker">${esc(sections.subtitle)}</div>
    <h1>Security Assessment Report</h1>
    <div class="project">${esc(project?.name ?? 'Unnamed project')}</div>
    <div class="target">${esc(project?.baseUrl ?? '')}${project?.environment ? ` · ${esc(project.environment)}` : ''} · ${esc(dateLong)}</div>

    <div class="cover-facts">
      <div class="fact">
        <div class="fact-label">Security score</div>
        <div class="fact-value" style="color:${scoreColor(score)}">${
          score === null ? '—' : `${score}<span style="font-size:9pt;color:${T.faint}">/100</span>`
        }</div>
      </div>
      <div class="fact"><div class="fact-label">Risk level</div><div class="fact-value">${esc(summary?.riskLevel ?? '—')}</div></div>
      <div class="fact"><div class="fact-label">Findings</div><div class="fact-value">${summary?.totalFindings ?? sorted.length}</div></div>
      <div class="fact"><div class="fact-label">Report version</div><div class="fact-value">v${version ?? 1}</div></div>
    </div>

    ${scoreCaveat ? `<div class="caveat">${esc(scoreCaveat)}</div>` : ''}
  </header>

  <h2 class="section-title">Assessment summary</h2>
  <div class="metrics">
    ${metric('Endpoints tested', `${summary?.testedEndpoints ?? 0} / ${summary?.totalEndpoints ?? 0}`)}
    ${metric('Checks executed', `${summary?.successfulChecks ?? 0} / ${summary?.plannedChecks ?? 0}`)}
    ${metric('Duration', assessment?.duration ? `${Math.round(assessment.duration)}s` : '—')}
  </div>

  <div class="sev-grid">${severityCells}</div>

  ${sections.owasp && owaspRows ? `
  <h2 class="section-title">Findings by OWASP category</h2>
  <p class="section-note">Distribution of the findings in this report across OWASP API Security Top 10 categories. This is a breakdown of what was found, not a measure of category coverage.</p>
  <table class="table">
    <thead><tr><th>Category</th><th class="num">Findings</th></tr></thead>
    <tbody>${owaspRows}</tbody>
  </table>` : ''}

  <h2 class="section-title">Findings</h2>
  ${sorted.length === 0
    ? `<div class="empty">No findings were recorded for this assessment.</div>`
    : `<p class="section-note">${sorted.length} finding${sorted.length === 1 ? '' : 's'}, ordered by severity. Content reflects the scan as recorded at issue time.</p>${findingSections}`}

  ${remainderTable}
  ${methodology}

</body>
</html>`;
}

/**
 * Chromium print header — a thin brand rule above every page after the cover.
 *
 * Chromium renders these templates in an isolated context with its own default
 * styles, so sizes are stated inline and in px. `.pageNumber` / `.totalPages`
 * are substituted by Chromium.
 */
export function pdfHeaderTemplate(): string {
  return `<div style="width:100%;font-size:7px;color:#6b6b6b;padding:0 14mm;
    font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <span>${escapeForTemplate(appBrand.name)}</span>
  </div>`;
}

export function pdfFooterTemplate(reportId?: string): string {
  const ref = reportId ? ` &nbsp;·&nbsp; ${escapeForTemplate(reportId.slice(0, 8))}` : '';
  return `<div style="width:100%;font-size:7px;color:#6b6b6b;padding:0 14mm;
    font-family:-apple-system,Segoe UI,Roboto,sans-serif;
    display:flex;justify-content:space-between;align-items:center;">
    <span>${escapeForTemplate(appBrand.name)} &nbsp;·&nbsp; ${escapeForTemplate(appBrand.domain)}${ref}</span>
    <span>Confidential &nbsp;·&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}

function escapeForTemplate(value: string): string {
  return esc(value);
}
