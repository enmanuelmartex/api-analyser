import { appBrand } from '../../brand/brand';
import { markDataUri } from '../../brand/brand-assets';
import { PAGINATOR_SCRIPT } from './report-paginator';

/**
 * The report document.
 *
 * This is a printed document, not the application's dashboard exported to
 * paper. The distinction drives every decision below:
 *
 *   • Pages are real. `@page { margin: 0 }` and Puppeteer's zero margins hand
 *     the whole 210×297mm sheet to the document, and `report-paginator.ts`
 *     measures content into fixed-size `.sheet` boxes that carry their own
 *     safe area, running header, footer and page number. Nothing is left for
 *     Chromium to cut arbitrarily.
 *   • The cover is a page, not a banner. It is the only dark surface in the
 *     document and it is full-bleed, so it can never read as a dark card
 *     floating on white paper.
 *   • Interior pages are white and typographic. Figures are set on rules with
 *     small-caps labels rather than in bordered tiles — a bordered tile is a
 *     dashboard idiom and makes a document look like a screenshot.
 *
 * Print correctness constraints that shape the CSS:
 *   • `print-color-adjust: exact` — without it Chromium drops every background
 *     and the cover prints as black text on white.
 *   • No webfonts. A `@font-face` pointing at Google Fonts would make report
 *     generation depend on outbound network access, which fails in a
 *     locked-down container and silently reflows the document.
 *   • Page numbers are resolved by the paginator, not by CSS counters (not
 *     supported in Chromium print) and not by Chromium's header/footer
 *     templates (which only render inside a paper margin this document does
 *     not have).
 */

export type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};

const SEVERITY_KEYS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

/**
 * The severity palette — the document's single source of severity colour.
 *
 * Conventional vulnerability-severity hues, so the ranking is legible before a
 * word is read: red, orange, amber, blue, slate. The previous printable set was
 * darkened for contrast, which pulled orange and amber into brown and lost the
 * one distinction that matters most — high against medium.
 *
 * Blue for LOW rather than green is deliberate: a green vulnerability reads as
 * "passed", and a low-severity finding is still a finding.
 *
 * `color` is the accent, used unmodified everywhere severity is shown: donut
 * segments, legend swatches, the severity rules and counts, the rule down the
 * side of a finding, and the fill of the severity badge.
 *
 * `onColor` is the badge label against that fill. Orange and amber are too
 * light to be set as 6.5pt type — `#F59E0B` on its own tint measures 1.8:1,
 * which disappears in print — and darkening them enough to read turns both to
 * brown and destroys the high/medium distinction. So the badge is filled with
 * the exact severity colour and the label takes whichever of white or near
 * black clears contrast against it, the way warning signage does: white on
 * red and blue, black on orange and amber.
 */
const SEVERITY: Record<string, { label: string; color: string; onColor: string }> = {
  CRITICAL: { label: 'Critical', color: '#DC2626', onColor: '#ffffff' },
  HIGH:     { label: 'High',     color: '#F97316', onColor: '#1f2937' },
  MEDIUM:   { label: 'Medium',   color: '#F59E0B', onColor: '#1f2937' },
  LOW:      { label: 'Low',      color: '#3B82F6', onColor: '#ffffff' },
  INFO:     { label: 'Info',     color: '#64748B', onColor: '#ffffff' },
};

/**
 * Interior pages: ink on paper.
 *
 * `accent` is the brand Blue darkened until it clears 6.5:1 on paper — the
 * document is read on screen, printed in colour and photocopied in grey, and it
 * has to survive all three.
 */
const P = {
  ink: '#12161c',
  body: '#2f3844',
  muted: '#5c6675',
  faint: '#8892a1',
  rule: '#d8dee6',
  ruleSoft: '#e9edf2',
  wash: '#f5f7f9',
  accent: '#0F5FC2',
  paper: '#ffffff',
};

/** The cover: the document's only dark surface. Canvas and brand Blue. */
const C = {
  bg: '#08080A',
  ink: '#f7f8f9',
  muted: '#9aa3af',
  faint: '#69717c',
  rule: '#23262e',
  accent: '#2E8BF5',
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
  if (score === null) return P.faint;
  if (score >= 80) return '#1a7f45';
  if (score >= 60) return '#8a6100';
  if (score >= 40) return '#a5510a';
  return '#a8121a';
}

function scoreBand(score: number | null): string {
  if (score === null) return 'Not scored';
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Adequate';
  if (score >= 40) return 'Weak';
  return 'Critical';
}

function chip(severity: string): string {
  const s = SEVERITY[severity] ?? SEVERITY.INFO;
  return `<span class="chip" style="color:${s.onColor};background:${s.color};border-color:${s.color}">${esc(s.label.toUpperCase())}</span>`;
}

/**
 * CVSS to one decimal, which is how the specification defines a base score.
 *
 * The value arrives from a Decimal column and can carry binary-float noise, so
 * printing it raw risks a cell reading "3.0999999999999996" in a table sized
 * for three characters.
 */
function cvss(value: unknown): string {
  const score = Number(value);
  return Number.isFinite(score) ? score.toFixed(1) : '—';
}

const ZERO_WIDTH_SPACE = '\u200B';

/**
 * A URL or route, escaped and made to wrap at its own separators.
 *
 * A long path in a narrow table column has no spaces to break at, so the
 * browser either overflows the cell or splits mid-segment ("…/sub-resource/c
 * ollection"). Zero-width spaces after the separators give it legitimate break
 * opportunities, and print as nothing.
 */
function path(value: unknown): string {
  return esc(String(value ?? '').replace(/([/?&=._-])/g, `$1${ZERO_WIDTH_SPACE}`));
}

/** A key/value row in an overview list. Rules, not boxes. */
function row(label: string, value: string): string {
  return `<div class="kv"><div class="kv-k">${esc(label)}</div><div class="kv-v">${value}</div></div>`;
}

/** A labelled prose block inside a finding. Omitted entirely when empty. */
function block(label: string, body: string | null | undefined, cls = ''): string {
  if (!body) return '';
  return `<div class="blk ${cls}">
    <div class="blk-k">${esc(label)}</div>
    <div class="blk-v">${esc(body)}</div>
  </div>`;
}

/**
 * How much of an evidence dump a page can hold.
 *
 * Evidence is unbounded — a scanner can capture a megabyte of response body —
 * and a document made of fixed pages has to bound it somewhere. It is bounded
 * here, in the text, rather than by clipping in CSS: a reader must never be
 * shown silently-truncated evidence and take it for the whole record.
 */
const EVIDENCE_MAX_LINES = 30;
const EVIDENCE_MAX_CHARS = 2400;

/** Evidence rendered as preformatted text, never as prose. */
function evidenceBlock(label: string, body: unknown): string {
  if (body === null || body === undefined || body === '') return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

  const lines = text.split('\n');
  let shown = lines.slice(0, EVIDENCE_MAX_LINES).join('\n');
  if (shown.length > EVIDENCE_MAX_CHARS) {
    // Cut back to a line boundary: a half-printed line reads as corruption
    // rather than as an omission the note below accounts for.
    const clipped = shown.slice(0, EVIDENCE_MAX_CHARS);
    const boundary = clipped.lastIndexOf('\n');
    shown = boundary > 0 ? clipped.slice(0, boundary) : clipped;
  }

  const truncated = shown.length < text.length;
  const omitted = lines.length - shown.split('\n').length;

  return `<div class="blk">
    <div class="blk-k">${esc(label)}</div>
    <pre class="evidence">${esc(shown)}</pre>
    ${truncated
      ? `<div class="truncated">Truncated for print${
          omitted > 0 ? ` — ${omitted} further line${omitted === 1 ? '' : 's'} omitted` : ''
        }. The complete evidence is in the JSON and SARIF exports of this assessment.</div>`
      : ''}
  </div>`;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) +
    ' · ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDuration(seconds: unknown): string {
  const total = Math.round(Number(seconds ?? 0));
  if (!Number.isFinite(total) || total <= 0) return '—';
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${total % 60}s`;
}

/**
 * The severity donut.
 *
 * Radius 15.9155 gives a circumference of exactly 100, so each arc length is
 * the percentage itself — no rounding drift accumulating across five segments.
 */
function donut(counts: Record<string, number>, total: number): string {
  if (total <= 0) return '';
  let offset = 0;
  const arcs = SEVERITY_KEYS.filter((key) => counts[key] > 0).map((key) => {
    const share = (counts[key] / total) * 100;
    const arc = `<circle class="arc" r="15.9155" cx="21" cy="21" fill="none"
      stroke="${SEVERITY[key].color}" stroke-width="6"
      stroke-dasharray="${share.toFixed(3)} ${(100 - share).toFixed(3)}"
      stroke-dashoffset="${(-offset).toFixed(3)}"></circle>`;
    offset += share;
    return arc;
  }).join('');

  return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Findings by severity">
    <circle r="15.9155" cx="21" cy="21" fill="none" stroke="${P.ruleSoft}" stroke-width="6"></circle>
    <g transform="rotate(-90 21 21)">${arcs}</g>
    <text x="21" y="20.4" class="donut-n">${total}</text>
    <text x="21" y="25" class="donut-k">FINDINGS</text>
  </svg>`;
}

export interface TemplateInput {
  assessment: any;
  type: ReportType;
  /** Report id, shown truncated in the running footer for traceability. */
  reportId?: string;
  version?: number;
}

export function renderReportHtml({ assessment, type, reportId, version }: TemplateInput): string {
  const { project, summary, findings } = assessment;
  const sections = sectionsFor(type);
  /*
   * Two files, not one recoloured file. The cover is the document's only dark
   * surface, every other page is paper, and a `data:` URI cannot inherit
   * `currentColor` — so each surface gets the artwork drawn for it.
   */
  const coverMark = markDataUri('dark');
  const pageMark = markDataUri('light');

  const generatedAt = new Date();
  const dateLong = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Read from the stored snapshot, never recomputed — a report must not change
  // because issues were re-triaged after it was issued.
  const score: number | null = summary?.securityScore ?? null;
  const scoreStatus = summary?.scoreStatus ?? 'UNAVAILABLE';
  const projectName = project?.name ?? 'Unnamed project';

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

  /*
   * The document counts what the document lists.
   *
   * These used to be read from the persisted summary counters while the pages
   * below were built from `sorted`, so a report could open by claiming fourteen
   * findings and then itemise thirteen — the counters were written from the
   * scanner's raw detections, the body from the deduplicated occurrences. The
   * scanner now records the same number, but a report must not be able to
   * contradict itself if a stored summary is ever stale, so the totals are
   * derived here from the findings actually being rendered.
   */
  const counts: Record<string, number> = {};
  for (const key of SEVERITY_KEYS) counts[key] = 0;
  for (const f of sorted) {
    if (counts[f.severity] !== undefined) counts[f.severity] += 1;
  }
  const countedTotal = SEVERITY_KEYS.reduce((sum, key) => sum + counts[key], 0);
  const totalFindings = sorted.length;

  // ── Findings by OWASP category ────────────────────────────────────────────
  // Named for what it counts. "Coverage" over a table of finding counts implies
  // checks executed per category — a different and more flattering claim than
  // "these are the categories the findings fell into".
  const owaspCounts: Record<string, number> = {};
  for (const f of sorted) {
    if (f.owaspCategory) owaspCounts[f.owaspCategory] = (owaspCounts[f.owaspCategory] ?? 0) + 1;
  }
  const owaspRows = Object.entries(owaspCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `<tr><td class="mono">${esc(cat)}</td><td class="num">${count}</td></tr>`)
    .join('');

  /*
   * Check coverage, which is a different question from the counts above.
   *
   * "Which categories did findings fall into" and "which categories do we have
   * a check for" are not the same, and only the second one answers "was this
   * tested". A compliance reader seeing no API9 findings must be able to tell
   * whether API9 was tested and clean, or never tested at all.
   */
  const coverage = (assessment as any).owaspCoverage;
  const coverageRows = coverage
    ? coverage.categories
        .map((category: any) => {
          const covered = category.status === 'COVERED';
          const found = owaspCounts[category.id] ?? 0;
          return `<tr>
            <td class="mono">${esc(category.shortId)}</td>
            <td>${esc(category.title)}</td>
            <td><span class="cov ${covered ? 'cov-yes' : 'cov-no'}">${covered ? 'Covered' : 'Not covered'}</span></td>
            <td class="num">${covered ? category.checkIds.length : '—'}</td>
            <td class="num">${covered ? found : '—'}</td>
          </tr>${
            /*
             * The qualifying sentence travels with its row, whichever kind it
             * is. "Not covered" on its own reads as an oversight; "Covered" on
             * its own reads as exhaustive. Both are corrected here or nowhere,
             * because a reader of the PDF has nothing else to consult.
             */
            covered
              ? category.scopeNote
                ? `<tr class="cov-reason" data-with-prev><td></td><td colspan="4">${esc(category.scopeNote)}</td></tr>`
                : ''
              : `<tr class="cov-reason" data-with-prev><td></td><td colspan="4">${esc(category.gapReason ?? '')}</td></tr>`
          }`;
        })
        .join('')
    : '';

  // ── Cover ─────────────────────────────────────────────────────────────────

  const coverFigures = [
    { k: 'Security score', v: score === null ? '—' : `${score}<span class="unit">/100</span>`, c: score === null ? C.muted : undefined },
    { k: 'Risk level', v: esc(summary?.riskLevel ?? '—') },
    { k: 'Findings', v: String(totalFindings) },
    { k: 'Endpoints tested', v: String(summary?.testedEndpoints ?? 0) },
  ].map((f) => `<div class="fig">
      <div class="fig-k">${esc(f.k)}</div>
      <div class="fig-v"${f.c ? ` style="color:${f.c}"` : ''}>${f.v}</div>
    </div>`).join('');

  const cover = `<section class="sheet sheet-cover" data-sheet="cover">
    <div class="cover-art" aria-hidden="true">
      <svg viewBox="0 0 400 400" preserveAspectRatio="none">
        <g fill="none" stroke="#2E8BF5" stroke-width="1.1">
          ${[110, 170, 230, 290, 350].map((r) => `<circle cx="400" cy="0" r="${r}"></circle>`).join('')}
        </g>
        <g fill="none" stroke="#6D4BFF" stroke-width="1.1" opacity="0.8">
          ${[140, 260].map((r) => `<circle cx="400" cy="0" r="${r}"></circle>`).join('')}
        </g>
      </svg>
    </div>

    <header class="cover-top">
      <div class="cover-brand">
        ${coverMark ? `<img class="cover-mark" src="${coverMark}" alt="">` : ''}
        <span>${esc(appBrand.name)}</span>
      </div>
      <div class="cover-doctype">${esc(sections.subtitle)}</div>
    </header>

    <div class="cover-title">
      <div class="cover-kicker">API Security</div>
      <h1>Assessment<br>Report</h1>
      <div class="cover-rule"></div>
      <div class="cover-subject">${esc(projectName)}</div>
      <dl class="cover-meta">
        <div><dt>Target</dt><dd class="mono">${path(project?.baseUrl ?? '—')}</dd></div>
        <div><dt>Environment</dt><dd>${esc(project?.environment ?? '—')}</dd></div>
        <div><dt>Issued</dt><dd>${esc(dateLong)}</dd></div>
      </dl>
    </div>

    <footer class="cover-foot">
      <div class="cover-figs">${coverFigures}</div>
      ${scoreCaveat ? `<div class="cover-caveat">${esc(scoreCaveat)}</div>` : ''}
      <div class="cover-note">
        <span>Confidential — prepared for ${esc(projectName)}</span>
        <span>${esc(appBrand.domain)}</span>
      </div>
    </footer>
  </section>`;

  // ── Section builders ──────────────────────────────────────────────────────

  interface Section { id: string; title: string; blocks: string; }
  const built: Section[] = [];

  const head = (id: string, index: number, title: string) =>
    `<header class="sec" data-start="page" data-keep-next data-anchor="${id}">
      <div class="sec-eyebrow">Section ${String(index).padStart(2, '0')}</div>
      <h2 class="sec-t">${esc(title)}</h2>
    </header>`;

  const sub = (title: string) => `<h3 class="sub" data-keep-next>${esc(title)}</h3>`;
  const lede = (text: string) => `<p class="lede" data-keep-next>${esc(text)}</p>`;
  const note = (text: string) => `<p class="note">${esc(text)}</p>`;
  const label = (text: string) => `<div class="minor" data-keep-next>${esc(text)}</div>`;

  // Executive summary ────────────────────────────────────────────────────────
  const worst = sorted[0]?.severity;
  const urgent = counts.CRITICAL + counts.HIGH;
  const postureSentences = [
    `${projectName} was assessed against the OWASP API Security Top 10 on ${dateLong}.`,
    score === null
      ? 'No security score could be computed for this scan.'
      : `The assessment returned a security score of ${score} out of 100 (${scoreBand(score).toLowerCase()}) and an overall risk level of ${String(summary?.riskLevel ?? 'unknown').toLowerCase()}.`,
    totalFindings === 0
      ? 'No findings were recorded by the checks that ran.'
      : `${totalFindings} finding${totalFindings === 1 ? '' : 's'} ${totalFindings === 1 ? 'was' : 'were'} recorded across ${summary?.testedEndpoints ?? 0} of ${summary?.totalEndpoints ?? 0} discovered endpoints, the most severe rated ${String(SEVERITY[worst]?.label ?? '—').toLowerCase()}.`,
    urgent > 0
      ? `${urgent} of them ${urgent === 1 ? 'is' : 'are'} critical or high severity and ${urgent === 1 ? 'warrants' : 'warrant'} remediation before the next release.`
      : '',
  ].filter(Boolean).join(' ');

  const scopeSentence =
    `${summary?.successfulChecks ?? 0} of ${summary?.plannedChecks ?? 0} planned checks completed` +
    (coverage ? `, covering ${coverage.label} of the OWASP API Security Top 10 (2023).` : '.') +
    ' Categories with no check behind them are reported as not covered: an absence of findings there is not evidence of security.';

  const severityColumns = SEVERITY_KEYS.map((key) => {
    const s = SEVERITY[key];
    return `<div class="sev-col" style="border-top-color:${s.color}">
      <div class="sev-n" style="color:${counts[key] ? s.color : P.faint}">${counts[key]}</div>
      <div class="sev-k">${s.label}</div>
    </div>`;
  }).join('');

  const priorities = sorted.slice(0, 3).map((f: any, i: number) => `<div class="pri">
      <div class="pri-n">${String(i + 1).padStart(2, '0')}</div>
      <div class="pri-body">
        <div class="pri-t">${esc(f.title)}</div>
        <div class="pri-m">${path(f.endpoint?.path ?? f.affectedUrl ?? '—')}${f.owaspCategory ? ` · ${esc(f.owaspCategory)}` : ''}</div>
      </div>
      <div class="pri-s">${chip(f.severity)}</div>
    </div>`).join('');

  built.push({
    id: 'exec',
    title: 'Executive summary',
    blocks: [
      lede(postureSentences),
      note(scopeSentence),
      scoreCaveat ? `<div class="caveat">${esc(scoreCaveat)}</div>` : '',
      label('Security posture'),
      `<div class="meter-wrap">
        <div class="meter">
          <div class="meter-fill" style="width:${score === null ? 0 : Math.max(0, Math.min(100, score))}%;background:${scoreColor(score)}"></div>
        </div>
        <div class="meter-scale"><span>0</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
        <div class="meter-read">
          <strong style="color:${scoreColor(score)}">${score === null ? '—' : score}<span class="unit">/100</span></strong>
          <span>${esc(scoreBand(score))} · ${esc(String(summary?.riskLevel ?? '—'))} risk</span>
        </div>
      </div>`,
      label('Findings by severity'),
      `<div class="sevrow">${severityColumns}</div>`,
      priorities ? label('Priority attention') : '',
      priorities ? `<div class="pri-list">${priorities}</div>` : '',
    ].filter(Boolean).join(''),
  });

  // Scan overview ────────────────────────────────────────────────────────────
  const plugins = summary?.pluginResults;
  built.push({
    id: 'scan',
    title: 'Scan overview',
    blocks: [
      lede('The parameters this report was produced from. Every figure below is read from the snapshot taken when the assessment completed, so this page describes the scan as it ran, not the current state of the API.'),
      label('Engagement'),
      `<div class="kvs">
        ${row('Project', esc(projectName))}
        ${row('Target', `<span class="mono">${path(project?.baseUrl ?? '—')}</span>`)}
        ${row('Environment', esc(project?.environment ?? '—'))}
        ${row('Assessment', `<span class="mono">${esc(String(assessment?.id ?? '—'))}</span>`)}
        ${row('Report type', esc(sections.subtitle))}
        ${row('Report version', `v${version ?? 1}`)}
        ${row('Issued', esc(dateLong))}
      </div>`,
      label('Execution'),
      `<div class="kvs">
        ${row('Started', esc(fmtDate(assessment?.startedAt)))}
        ${row('Completed', esc(fmtDate(assessment?.completedAt)))}
        ${row('Duration', esc(fmtDuration(assessment?.duration)))}
        ${row('Endpoints discovered', String(summary?.totalEndpoints ?? 0))}
        ${row('Endpoints tested', `${summary?.testedEndpoints ?? 0} of ${summary?.totalEndpoints ?? 0}`)}
        ${row('Checks executed', `${summary?.successfulChecks ?? 0} of ${summary?.plannedChecks ?? 0}`)}
        ${plugins?.skipped?.length ? row('Checks skipped', String(plugins.skipped.length)) : ''}
        ${plugins?.failed?.length ? row('Checks failed', String(plugins.failed.length)) : ''}
        ${row('Score status', esc(String(scoreStatus)))}
      </div>`,
    ].filter(Boolean).join(''),
  });

  // Findings summary ─────────────────────────────────────────────────────────
  const register = sorted.length
    ? `<div class="tblock" data-split="rows" data-title="Findings register">
        <table class="table">
          <thead><tr>
            <th class="tight">#</th><th>Severity</th><th>Finding</th><th>Endpoint</th><th class="num">CVSS</th>
          </tr></thead>
          <tbody>${sorted.map((f: any, i: number) => `<tr>
            <td class="tight num">${String(i + 1).padStart(2, '0')}</td>
            <td>${chip(f.severity)}</td>
            <td>${esc(f.title)}</td>
            <td class="mono wrap">${path(f.endpoint?.path ?? f.affectedUrl ?? '—')}</td>
            <td class="num">${f.cvssScore != null ? cvss(f.cvssScore) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
    : `<div class="empty">No findings were recorded for this assessment.</div>`;

  built.push({
    id: 'summary',
    title: 'Findings summary',
    blocks: [
      lede(sorted.length
        ? `Every finding recorded by this assessment, ordered by severity and then by CVSS score. Detailed entries follow in the next section.`
        : 'The checks that ran recorded no findings. This is not a statement that the API is free of vulnerabilities — see the coverage section for what was and was not tested.'),
      countedTotal > 0
        ? `<div class="split">
            ${donut(counts, countedTotal)}
            <div class="legend">
              ${SEVERITY_KEYS.map((k) => `<div class="legend-row">
                <span class="swatch" style="background:${counts[k] ? SEVERITY[k].color : P.ruleSoft}"></span>
                <span class="legend-k">${SEVERITY[k].label}</span>
                <span class="legend-v">${counts[k]}</span>
                <span class="legend-p">${countedTotal ? Math.round((counts[k] / countedTotal) * 100) : 0}%</span>
              </div>`).join('')}
            </div>
          </div>`
        : '',
      register,
    ].filter(Boolean).join(''),
  });

  // Detailed findings ────────────────────────────────────────────────────────
  const findingBlocks = detailed.map((f: any, i: number) => {
    const s = SEVERITY[f.severity] ?? SEVERITY.INFO;
    const endpoint = f.endpoint?.path
      ? `${esc(f.endpoint.method ?? '')} ${path(f.endpoint.path)}`.trim()
      : f.affectedUrl ? path(f.affectedUrl) : '';

    const meta = [
      f.owaspCategory ? `OWASP ${esc(f.owaspCategory)}` : '',
      f.cweId ? `CWE ${esc(f.cweId)}` : '',
      f.pluginId ? `${esc(f.pluginId)} check` : '',
      f.cvssScore != null ? `CVSS ${cvss(f.cvssScore)}` : '',
    ].filter(Boolean).join('<span class="dot">·</span>');

    /*
     * AI output is walled off from scanner evidence.
     *
     * Everything above this block was observed by a check. The guidance below
     * was written by a language model from that observation, and is labelled as
     * such with no promotional framing — a reader must never mistake generated
     * prose for something the scanner saw.
     */
    const g = f.guidance;
    const ai = g && sections.narrative
      ? `<div class="ai" data-split="children" data-title="AI security guidance">
          <div class="ai-label">AI security guidance — advisory, not scanner evidence</div>
          ${g.summary ? `<p>${esc(g.summary)}</p>` : ''}
          ${g.rootCause ? `<p><span class="ai-sub">Likely root cause.</span> ${esc(g.rootCause)}</p>` : ''}
          ${g.businessImpact ? `<p><span class="ai-sub">Business impact.</span> ${esc(g.businessImpact)}</p>` : ''}
          ${Array.isArray(g.remediation?.steps) && g.remediation.steps.length
            ? `<p class="ai-sub">Recommended fix</p><ol>${g.remediation.steps
                .map((step: any) => `<li>${esc(step.title)}${step.description ? ` — ${esc(step.description)}` : ''}</li>`)
                .join('')}</ol>` : ''}
          ${Array.isArray(g.environmentGuidance) && g.environmentGuidance.length
            ? `<p class="ai-sub">Environment-specific</p><ul>${g.environmentGuidance
                .map((entry: any) => `<li><strong>${esc(entry.technology)}</strong> <span class="ai-basis">(${esc(entry.basis ?? 'UNKNOWN')})</span> — ${esc(entry.guidance)}</li>`)
                .join('')}</ul>` : ''}
          ${Array.isArray(g.verification?.steps) && g.verification.steps.length
            ? `<p class="ai-sub">How to verify</p><ol>${g.verification.steps.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ol>${
                g.verification.expectedResult ? `<p><span class="ai-sub">Expected.</span> ${esc(g.verification.expectedResult)}</p>` : ''
              }` : ''}
          ${Array.isArray(g.falsePositiveConsiderations) && g.falsePositiveConsiderations.length
            ? `<p class="ai-sub">Could this be a false positive?</p><ul>${g.falsePositiveConsiderations.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          ${Array.isArray(g.references) && g.references.length
            ? `<p class="ai-sub">References</p><ul>${g.references
                .map((r: any) => `<li>${esc(r.title)}${r.url ? ` — <span class="mono">${esc(r.url)}</span>` : ''}</li>`)
                .join('')}</ul>` : ''}
          ${g._meta
            ? `<div class="ai-meta">Generated with ${esc(g._meta.provider)}${g._meta.model ? ` · ${esc(g._meta.model)}` : ''}
               · prompt ${esc(g._meta.promptVersion)} · knowledge ${esc(g._meta.knowledgeVersion)}${
                 g._meta.confidence != null ? ` · confidence ${Math.round(g._meta.confidence * 100)}%` : ''
               }</div>` : ''}
        </div>` : '';

    const index = String(i + 1).padStart(2, '0');

    return `<article class="fnd" data-split="children" data-title="Finding ${esc(index)} — ${esc(f.title)}">
      <div class="fnd-head" style="border-left-color:${s.color}">
        <div class="fnd-top">
          <span class="fnd-n">${index}</span>
          ${chip(f.severity)}
        </div>
        <h3 class="fnd-t">${esc(f.title)}</h3>
        ${endpoint ? `<div class="fnd-ep mono">${endpoint}</div>` : ''}
        ${meta ? `<div class="fnd-m">${meta}</div>` : ''}
      </div>

      ${sections.narrative ? block('Description', f.description) : ''}
      ${sections.evidence ? evidenceBlock('Evidence', f.evidence) : ''}
      ${sections.evidence && f.httpRequest ? evidenceBlock('Request (redacted)', f.httpRequest) : ''}
      ${sections.evidence && f.httpResponse ? evidenceBlock('Response (redacted)', f.httpResponse) : ''}
      ${sections.narrative ? block('Impact', f.impact) : ''}
      ${sections.narrative ? block('Remediation', f.remediation, 'fix') : ''}
      ${sections.reproduction && f.endpoint?.path
        ? block('Verification', `Re-run the ${f.pluginId ?? 'relevant'} check against ${f.endpoint.method ?? ''} ${f.endpoint.path} and confirm the finding no longer reproduces.`)
        : ''}
      ${ai}
      ${f.references?.length
        ? `<div class="blk"><div class="blk-k">References</div><ul class="refs">${f.references.map((r: string) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
        : ''}
    </article>`;
  }).join('');

  if (detailed.length) {
    built.push({
      id: 'detail',
      title: 'Detailed findings',
      blocks: lede(`${detailed.length} finding${detailed.length === 1 ? '' : 's'} in full detail, ordered by severity. Content reflects the scan as recorded at issue time.`) + findingBlocks,
    });
  }

  if (remainder.length) {
    built.push({
      id: 'more',
      title: 'Additional findings',
      blocks: lede(`${remainder.length} further finding${remainder.length === 1 ? '' : 's'} of lower priority, listed for completeness. Full detail is available in the technical report.`) +
        `<div class="tblock" data-split="rows" data-title="Additional findings">
          <table class="table">
            <thead><tr><th>Severity</th><th>Finding</th><th>Endpoint</th></tr></thead>
            <tbody>${remainder.map((f: any) => `<tr>
              <td>${chip(f.severity)}</td>
              <td>${esc(f.title)}</td>
              <td class="mono wrap">${path(f.endpoint?.path ?? f.affectedUrl ?? '—')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`,
    });
  }

  // OWASP ────────────────────────────────────────────────────────────────────
  const owaspByCategory = owaspRows
    ? sub('Findings by OWASP category') +
      note('Distribution of the findings in this report across OWASP API Security Top 10 categories. This is a breakdown of what was found, not a measure of category coverage.') +
      `<div class="tblock" data-split="rows" data-title="Findings by OWASP category">
        <table class="table">
          <thead><tr><th>Category</th><th class="num">Findings</th></tr></thead>
          <tbody>${owaspRows}</tbody>
        </table>
      </div>`
    : '';

  if (sections.owasp && coverageRows) {
    built.push({
      id: 'owasp',
      title: 'OWASP API Security Top 10 coverage',
      blocks: [
        lede(`Which categories the installed security checks test. Coverage is ${coverage.label} of the 2023 edition, across ${coverage.checkCount} checks and ${coverage.ruleCount} rules. A category marked "Not covered" was never examined — an absence of findings there is not evidence that the API is secure. Where a note follows a covered row, it states what that category's checks cannot reach from outside the target; a clean result there is correspondingly narrower.`),
        `<div class="tblock" data-split="rows" data-title="OWASP coverage">
          <table class="table">
            <thead><tr><th class="tight">ID</th><th>Category</th><th>Status</th><th class="num">Checks</th><th class="num">Findings</th></tr></thead>
            <tbody>${coverageRows}</tbody>
          </table>
        </div>`,
        owaspByCategory,
      ].filter(Boolean).join(''),
    });
  } else if (sections.owasp && owaspRows) {
    built.push({
      id: 'owasp',
      title: 'Findings by OWASP category',
      blocks: note('Distribution of the findings in this report across OWASP API Security Top 10 categories. This is a breakdown of what was found, not a measure of category coverage.') +
        `<div class="tblock" data-split="rows" data-title="Findings by OWASP category">
          <table class="table">
            <thead><tr><th>Category</th><th class="num">Findings</th></tr></thead>
            <tbody>${owaspRows}</tbody>
          </table>
        </div>`,
    });
  }

  // Methodology ──────────────────────────────────────────────────────────────
  if (sections.methodology && plugins) {
    built.push({
      id: 'method',
      title: 'Methodology and scan configuration',
      blocks: [
        lede('The checks this assessment ran, and those it did not. A skipped or failed check produces no findings, which is not the same as a clean result.'),
        `<div class="kvs">
          ${row('Checks executed', String(plugins.executed?.length ?? 0))}
          ${row('Checks skipped', String(plugins.skipped?.length ?? 0))}
          ${row('Checks failed', String(plugins.failed?.length ?? 0))}
        </div>`,
        plugins.executed?.length ? label('Executed') + `<p class="idlist mono">${esc(plugins.executed.join(', '))}</p>` : '',
        plugins.skipped?.length ? label('Skipped') + `<p class="idlist mono">${esc(plugins.skipped.join(', '))}</p>` : '',
        plugins.failed?.length ? label('Failed') + `<p class="idlist mono">${esc(plugins.failed.join(', '))}</p>` : '',
      ].filter(Boolean).join(''),
    });
  }

  // ── Contents ──────────────────────────────────────────────────────────────
  // Built last because it needs the final section list, inserted second because
  // that is where a reader expects it. Page numbers are filled by the paginator.
  const contents = `<header class="sec" data-start="page" data-keep-next>
      <div class="sec-eyebrow">Document</div>
      <h2 class="sec-t">Contents</h2>
    </header>
    <div class="toc">
      ${built.map((section, i) => `<div class="toc-row">
        <span class="toc-n">${String(i + 1).padStart(2, '0')}</span>
        <span class="toc-t">${esc(section.title)}</span>
        <span class="toc-dots"></span>
        <span class="toc-p" data-toc-page="${section.id}">—</span>
      </div>`).join('')}
    </div>`;

  const numbered = built.map((section, i) => head(section.id, i + 1, section.title) + section.blocks);
  const flow = [numbered[0], contents, ...numbered.slice(1)].join('');

  const footerRef = reportId
    ? esc(reportId.slice(0, 8))
    : esc(String(assessment?.id ?? '').slice(0, 8));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(appBrand.name)} ${esc(sections.subtitle)} — ${esc(projectName)}</title>
<style>
  /* Preserve surfaces in print. Without this Chromium strips every background
     and the cover prints as unstyled black-on-white. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; margin: 0; padding: 0; }

  /* The document owns the whole sheet: no paper margin, no Chromium furniture.
     Every page draws its own safe area, header and footer. */
  @page { size: 210mm 297mm; margin: 0; }

  html, body {
    background: ${P.paper};
    color: ${P.ink};
    /* System stack only — no network fetch during PDF generation. */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .mono, code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
  .unit { font-size: 0.55em; font-weight: 500; color: ${P.faint}; letter-spacing: 0; }

  /* ── The page ───────────────────────────────────────────────────────────── */
  /* One sheet is one A4 page. Fixed height and hidden overflow are what stop
     Chromium reflowing content across a boundary the paginator already chose. */
  .sheet {
    position: relative;
    width: 210mm;
    height: 297mm;
    padding: 14mm 18mm 12mm;
    background: ${P.paper};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sheet:last-child { break-after: auto; page-break-after: auto; }

  /* The content area. A definite height is what makes overflow measurable. */
  .pb { flex: 1 1 auto; min-height: 0; overflow: hidden; }

  .ph, .pf {
    flex: 0 0 auto;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 7pt; letter-spacing: 0.06em; color: ${P.faint};
    text-transform: uppercase;
  }
  .ph { padding-bottom: 2.5mm; margin-bottom: 7mm; border-bottom: 0.5pt solid ${P.rule}; }
  .pf { padding-top: 2.5mm; margin-top: 7mm; border-top: 0.5pt solid ${P.rule}; }
  .ph-brand { display: inline-flex; align-items: center; gap: 1.8mm;
              font-weight: 600; color: ${P.ink}; letter-spacing: 0.08em; }
  /* Furniture scale. The compact artwork exists for exactly this: the node
     network would be toner speckle at this size. */
  .ph-mark { width: 4.6mm; height: 4.6mm; }
  .pf-n, .pf-t { font-weight: 600; color: ${P.body}; font-variant-numeric: tabular-nums; }
  /* An opaque identifier is unreadable upper-cased and letter-spaced. */
  .pf-ref { text-transform: none; letter-spacing: 0; font-family: "SFMono-Regular", Consolas, monospace; }

  /* ── Cover ──────────────────────────────────────────────────────────────── */
  /* Full-bleed dark. The page IS the cover; there is no card on a white sheet. */
  .sheet-cover {
    background: ${C.bg};
    color: ${C.ink};
    padding: 20mm 20mm 18mm;
    justify-content: space-between;
  }
  /* Layered wash, drawn on the page itself so it reaches all four trims. */
  .sheet-cover::before {
    content: ''; position: absolute; inset: 0;
    /* Brand Blue #2E8BF5 and Violet #6D4BFF. These were the previous identity's
       blue and violet written as rgba(), which is why a hex search for the old
       palette did not find them and the cover kept printing a warm cast. */
    background:
      radial-gradient(60% 45% at 88% 10%, rgba(46,139,245,0.18), transparent 70%),
      radial-gradient(55% 40% at 0% 94%, rgba(109,75,255,0.10), transparent 70%);
  }
  /* Needs the same specificity as the flow children below, or the decoration is
     pulled back into the flex flow and pushes the lockup down the page.
     The arcs fill the empty upper right and are masked out before they reach
     the title: decoration must never compete with the type it sits behind. */
  .sheet-cover > .cover-art {
    position: absolute; right: 0; top: 0;
    width: 152mm; height: 152mm; opacity: 0.5;
    -webkit-mask-image: linear-gradient(205deg, #000 10%, transparent 74%);
    mask-image: linear-gradient(205deg, #000 10%, transparent 74%);
  }
  .cover-art svg { width: 100%; height: 100%; }
  .sheet-cover > .cover-top,
  .sheet-cover > .cover-title,
  .sheet-cover > .cover-foot { position: relative; }

  .cover-top { display: flex; justify-content: space-between; align-items: center;
               padding-bottom: 5mm; border-bottom: 0.5pt solid ${C.rule}; }
  /*
   * The cover lockup, proportioned from the official horizontal lockup rather
   * than eyeballed: the artwork sits in a square box whose visible mark is
   * 0.88 of the side, the wordmark's cap height is 0.381 of the mark height,
   * and the two are optically centred. A 10 mm box clears the brand's print
   * minimum and puts the wordmark at 13 pt.
   */
  .cover-brand { display: flex; align-items: center; gap: 3.3mm; font-size: 13pt; font-weight: 600; letter-spacing: -0.015em; }
  .cover-mark { width: 10mm; height: 10mm; }
  .cover-doctype { font-size: 7pt; letter-spacing: 0.2em; text-transform: uppercase; color: ${C.muted}; }

  .cover-title { margin-top: auto; padding-bottom: 6mm; }
  .cover-kicker { font-size: 8pt; letter-spacing: 0.28em; text-transform: uppercase; color: ${C.accent}; margin-bottom: 5mm; }
  .cover-title h1 { font-size: 40pt; line-height: 1.02; font-weight: 300; letter-spacing: -0.025em; }
  .cover-rule { width: 26mm; height: 1.6pt; background: ${C.accent}; margin: 8mm 0 6mm; }
  .cover-subject { font-size: 13pt; font-weight: 500; letter-spacing: -0.01em; margin-bottom: 5mm; }

  /* Shares the figure grid below it, so the cover has one set of column rules. */
  .cover-meta { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 6mm; }
  .cover-meta dt { font-size: 6.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.faint}; margin-bottom: 1.2mm; }
  .cover-meta dd { font-size: 8.5pt; color: ${C.muted}; }

  /* Figures on rules, not in tiles. A tile is a dashboard idiom. */
  .cover-figs { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 6mm; }
  .cover-figs .fig { border-top: 1pt solid ${C.rule}; padding-top: 3mm; }
  .cover-figs .fig-k { font-size: 6.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.faint}; }
  .cover-figs .fig-v { font-size: 17pt; font-weight: 500; margin-top: 2mm; letter-spacing: -0.02em;
                       font-variant-numeric: tabular-nums; }
  .cover-caveat { margin-top: 6mm; font-size: 8pt; color: #fdba74; border-left: 1.5pt solid #fb923c; padding-left: 3mm; }
  .cover-note { display: flex; justify-content: space-between; margin-top: 8mm;
                font-size: 6.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.faint}; }

  /* ── Section furniture ──────────────────────────────────────────────────── */
  /* Everything on an interior page starts on the same left grid line. */
  .sec { border-bottom: 1.2pt solid ${P.ink}; padding-bottom: 3mm; margin-bottom: 6mm;
         break-after: avoid; page-break-after: avoid; }
  .sec-eyebrow { font-size: 6.5pt; letter-spacing: 0.2em; text-transform: uppercase;
                 color: ${P.accent}; font-weight: 600; margin-bottom: 2.5mm; }
  .sec-t { font-size: 17pt; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }

  .sub { font-size: 10.5pt; font-weight: 600; letter-spacing: -0.01em; margin: 8mm 0 2.5mm;
         break-after: avoid; page-break-after: avoid; }
  .minor { font-size: 6.8pt; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
           color: ${P.muted}; margin: 8mm 0 3mm; break-after: avoid; page-break-after: avoid; }
  .lede { font-size: 10pt; line-height: 1.65; color: ${P.body}; margin-bottom: 4mm; max-width: 152mm; }
  .note { font-size: 8.5pt; line-height: 1.6; color: ${P.muted}; margin-bottom: 3mm; max-width: 152mm; }
  .caveat { margin: 4mm 0; padding: 2.5mm 0 2.5mm 3.5mm; border-left: 1.5pt solid #b45309;
            background: #fdf6ec; color: #7c4708; font-size: 8.5pt; }
  .idlist { font-size: 8pt; color: ${P.muted}; line-height: 1.7; word-break: break-word; }

  /* ── Figures ────────────────────────────────────────────────────────────── */
  .meter-wrap { margin-bottom: 2mm; }
  .meter { height: 3mm; background: ${P.ruleSoft}; overflow: hidden; }
  .meter-fill { height: 100%; }
  .meter-scale { display: flex; justify-content: space-between; margin-top: 1.5mm;
                 font-size: 6.5pt; color: ${P.faint}; font-variant-numeric: tabular-nums; }
  .meter-read { display: flex; align-items: baseline; gap: 4mm; margin-top: 3mm; }
  .meter-read strong { font-size: 20pt; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .meter-read span { font-size: 8pt; color: ${P.muted}; text-transform: uppercase; letter-spacing: 0.1em; }

  .sevrow { display: grid; grid-template-columns: repeat(5, 1fr); column-gap: 5mm; }
  .sev-col { border-top: 2pt solid; padding-top: 2.5mm; }
  .sev-n { font-size: 16pt; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .sev-k { font-size: 6.8pt; letter-spacing: 0.14em; text-transform: uppercase; color: ${P.muted}; margin-top: 1mm; }

  .split { display: flex; align-items: center; gap: 12mm; margin-bottom: 7mm; }
  .donut { width: 38mm; height: 38mm; flex: none; }
  .donut-n { font-size: 8px; font-weight: 600; text-anchor: middle; fill: ${P.ink}; }
  .donut-k { font-size: 2.6px; letter-spacing: 0.32px; text-anchor: middle; fill: ${P.faint}; }
  .legend { flex: 1; }
  .legend-row { display: grid; grid-template-columns: 3.5mm 1fr auto 12mm; align-items: center;
                gap: 3mm; padding: 1.8mm 0; border-bottom: 0.5pt solid ${P.ruleSoft}; font-size: 8.5pt; }
  .swatch { width: 3.5mm; height: 3.5mm; }
  .legend-k { color: ${P.body}; }
  .legend-v { font-weight: 600; font-variant-numeric: tabular-nums; }
  .legend-p { text-align: right; color: ${P.faint}; font-variant-numeric: tabular-nums; }

  /* ── Key/value lists ────────────────────────────────────────────────────── */
  .kvs { border-top: 0.5pt solid ${P.rule}; }
  .kv { display: grid; grid-template-columns: 48mm 1fr; gap: 4mm;
        padding: 2.2mm 0; border-bottom: 0.5pt solid ${P.ruleSoft};
        break-inside: avoid; page-break-inside: avoid; }
  .kv-k { font-size: 7.5pt; letter-spacing: 0.1em; text-transform: uppercase; color: ${P.muted}; }
  .kv-v { font-size: 9pt; color: ${P.ink}; word-break: break-word; }

  /* ── Contents ───────────────────────────────────────────────────────────── */
  .toc-row { display: grid; grid-template-columns: 9mm 1fr auto; align-items: baseline;
             gap: 3mm; padding: 3mm 0; border-bottom: 0.5pt solid ${P.ruleSoft}; }
  .toc-n { font-size: 8pt; font-weight: 600; color: ${P.accent}; font-variant-numeric: tabular-nums; }
  .toc-t { font-size: 10.5pt; color: ${P.ink}; }
  .toc-dots { display: none; }
  .toc-p { font-size: 9pt; font-weight: 600; color: ${P.body}; font-variant-numeric: tabular-nums; }

  /* ── Tables ─────────────────────────────────────────────────────────────── */
  .table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .table thead { display: table-header-group; }  /* repeat header across pages */
  .table th { text-align: left; color: ${P.muted}; font-size: 6.8pt; letter-spacing: 0.14em;
              text-transform: uppercase; font-weight: 600; padding: 0 3mm 2mm 0;
              border-bottom: 1pt solid ${P.ink}; }
  .table td { padding: 2.2mm 3mm 2.2mm 0; border-bottom: 0.5pt solid ${P.ruleSoft}; vertical-align: top; }
  .table th:last-child, .table td:last-child { padding-right: 0; }
  .table tr { break-inside: avoid; page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tight { width: 8mm; }
  /* Paths carry zero-width breaks at their separators; break-word uses those in
     preference to splitting a segment, and only falls back to a hard break when
     a single segment is genuinely wider than the column. */
  .wrap { overflow-wrap: break-word; word-break: break-word; }
  /* Coverage status is carried by a word, not only by colour: these documents
     are printed, photocopied and read by colour-blind reviewers. */
  .cov { font-size: 7pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  .cov-yes { color: #1a7f45; }
  .cov-no  { color: ${P.muted}; }
  .cov-reason td { padding-top: 0; font-size: 7.5pt; color: ${P.faint}; line-height: 1.5; }

  /* ── Findings ───────────────────────────────────────────────────────────── */
  /* A rule and a hanging severity mark, not a rounded card. */
  .fnd { padding-top: 5mm; margin-bottom: 5mm; border-top: 0.5pt solid ${P.rule}; }
  /* A separator rule immediately under the running header is a second header
     rule; the page break has already done the separating. */
  .pb > .fnd:first-child, .fnd[data-cont] { border-top: none; padding-top: 0; }
  .cont-note { font-size: 8pt; color: ${P.faint}; margin-bottom: 5mm; padding-bottom: 2mm;
               border-bottom: 0.5pt solid ${P.ruleSoft}; }
  .fnd-head { border-left: 2pt solid; padding-left: 4mm; margin-bottom: 4mm;
              break-after: avoid; page-break-after: avoid; }
  .fnd-top { display: flex; align-items: center; gap: 3mm; margin-bottom: 1.5mm; }
  .fnd-n { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.14em; color: ${P.accent};
           font-variant-numeric: tabular-nums; }
  .fnd-t { font-size: 12pt; font-weight: 600; letter-spacing: -0.015em; line-height: 1.25; }
  .fnd-ep { font-size: 8.5pt; color: ${P.accent}; margin-top: 1.5mm; overflow-wrap: break-word; }
  .fnd-m { font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: ${P.faint}; margin-top: 1.5mm; }
  .dot { padding: 0 5px; color: ${P.rule}; }
  .chip { font-size: 6.5pt; font-weight: 700; letter-spacing: 0.12em; padding: 0.6mm 1.8mm;
          border: 0.5pt solid; white-space: nowrap; }

  .blk { margin-bottom: 3.5mm; break-inside: avoid; page-break-inside: avoid; }
  .blk-k { font-size: 6.8pt; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600;
           color: ${P.muted}; margin-bottom: 1.2mm; }
  .blk-v { font-size: 9pt; color: ${P.body}; max-width: 158mm; }
  .fix .blk-v { border-left: 1.5pt solid #1a7f45; padding-left: 3mm; color: #14532d; }
  .evidence { background: ${P.wash}; border-left: 1.5pt solid ${P.rule};
              padding: 2.5mm 3mm; font-size: 7.5pt; color: ${P.body}; white-space: pre-wrap;
              word-break: break-word; max-height: 150mm; overflow: hidden; }
  .truncated { font-size: 7pt; color: ${P.muted}; margin-top: 1.2mm; font-style: italic; }
  .refs { padding-left: 4mm; font-size: 8pt; color: ${P.muted}; }

  /* AI guidance is visually subordinate to observed evidence. */
  .ai { margin: 4mm 0; padding: 3mm 0 3mm 4mm; border-left: 1.5pt solid ${P.rule}; background: ${P.wash};
        padding-right: 3mm; break-inside: avoid; page-break-inside: avoid; }
  .ai-label { color: ${P.accent}; font-size: 6.8pt; letter-spacing: 0.14em;
              text-transform: uppercase; font-weight: 600; margin-bottom: 2mm; }
  .ai p, .ai ul, .ai ol { font-size: 8.5pt; color: ${P.body}; margin-bottom: 1.5mm; }
  .ai ul, .ai ol { padding-left: 4.5mm; }
  .ai-sub { color: ${P.ink}; font-weight: 600; }
  .ai-basis { color: ${P.faint}; font-size: 7.5pt; }
  .ai-meta { margin-top: 2.5mm; padding-top: 1.5mm; border-top: 0.5pt solid ${P.rule};
             color: ${P.faint}; font-size: 7pt; line-height: 1.5; }

  /* ── Priorities ─────────────────────────────────────────────────────────── */
  .pri-list { border-top: 0.5pt solid ${P.rule}; }
  .pri { display: grid; grid-template-columns: 9mm 1fr auto; align-items: baseline; gap: 3mm;
         padding: 3mm 0; border-bottom: 0.5pt solid ${P.ruleSoft};
         break-inside: avoid; page-break-inside: avoid; }
  .pri-n { font-size: 8pt; font-weight: 600; color: ${P.faint}; font-variant-numeric: tabular-nums; }
  .pri-t { font-size: 9.5pt; color: ${P.ink}; }
  .pri-m { font-size: 7.5pt; color: ${P.faint}; margin-top: 0.8mm; overflow-wrap: break-word; }

  .empty { color: ${P.muted}; padding: 8mm 0; border-top: 0.5pt solid ${P.rule};
           border-bottom: 0.5pt solid ${P.rule}; font-size: 9pt; text-align: center; }

  /* On screen the HTML export shows the same sheets, laid out as pages. */
  @media screen {
    body { background: #6f7580; padding: 8mm 0; }
    .sheet { margin: 0 auto 6mm; box-shadow: 0 1px 10px rgba(0,0,0,0.4); }
  }
</style>
</head>
<body>

<div id="report-pages"></div>

<template id="report-furniture">
  <header class="ph">
    <span class="ph-brand">${pageMark ? `<img class="ph-mark" src="${pageMark}" alt="">` : ''}${esc(appBrand.name)}</span>
    <span>${esc(sections.subtitle)} — ${esc(projectName)}</span>
  </header>
  <footer class="pf">
    <span>${esc(appBrand.domain)}${footerRef ? ` · <span class="pf-ref">${footerRef}</span>` : ''} · v${version ?? 1}</span>
    <span>Confidential · Page <b class="pf-n"></b> of <b class="pf-t"></b></span>
  </footer>
</template>

<template id="report-source">${cover}${flow}</template>

<noscript><p style="padding:20mm">This report paginates itself when opened. Enable JavaScript, or use the PDF export.</p></noscript>

<script>${PAGINATOR_SCRIPT}</script>
</body>
</html>`;
}
