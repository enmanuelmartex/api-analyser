import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { appBrand, REPORT_TOOL_VERSION } from '../../brand/brand';
import { renderReportHtml } from './report-template';
import {
  countOccurrenceSeverities,
  findingSummaryFields,
} from '../assessments/assessment-finding-counts';

type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';

/** A4 at Chromium's 96dpi print resolution, used as the render viewport. */
const A4_VIEWPORT = { width: 794, height: 1123 };

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};

@Injectable()
export class ReportGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(ReportGeneratorService.name);

  constructor(
    private prisma: PrismaService,
    private registry: PluginRegistryService,
  ) {}

  /**
   * Says at boot whether this host can print PDFs.
   *
   * A missing browser used to surface only when somebody clicked Download —
   * three queue retries and a 503 later — with nothing in the startup output to
   * suggest the install was incomplete. One line at boot makes it a
   * configuration fact instead of a runtime surprise. It never throws: every
   * other report format renders without a browser, and an install that only
   * ever exports JSON or SARIF is perfectly valid.
   */
  onModuleInit(): void {
    try {
      this.logger.log(`PDF renderer: ${this.findBrowserExecutable()}`);
    } catch {
      this.logger.warn(
        'No PDF renderer found — PDF reports will fail; every other format is unaffected. ' +
          'Install Chromium or set CHROMIUM_EXECUTABLE_PATH.',
      );
    }
  }

  /**
   * Loads the data a report renders.
   *
   * Reports are built from the scan's OCCURRENCES, using the snapshot columns
   * captured at detection time. That is what makes a historical report
   * reproducible: re-importing a specification, rewording a check or retuning a
   * severity cannot retroactively alter a report that was already issued.
   *
   * Occurrences are projected onto the field names the renderers already use,
   * so the templates stay untouched, and each carries its persistent issue id
   * so a reader can navigate from a report entry to the live issue.
   */
  async getAssessmentData(assessmentId: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, project: { userId } },
      include: {
        project: { select: { id: true, name: true, baseUrl: true, environment: true } },
        summary: true,
        occurrences: {
          orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
          include: {
            endpoint: { select: { path: true, method: true } },
            issue: {
              select: {
                id: true,
                status: true,
                firstSeenAt: true,
                occurrenceCount: true,
                // Persisted AI guidance for the issue this detection belongs
                // to. Previously the report read `aiAnalysis` off the in-memory
                // finding, which existed only during the scan — so a report
                // regenerated later silently lost every piece of guidance.
                guidance: {
                  select: {
                    status: true,
                    payload: true,
                    provider: true,
                    model: true,
                    promptVersion: true,
                    knowledgeVersion: true,
                    confidence: true,
                    generatedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const findingCounts = countOccurrenceSeverities(assessment.occurrences);

    return {
      ...assessment,
      // All export formats receive the same occurrence-derived counters as the
      // finding list. This also makes regenerated reports for legacy scans
      // internally consistent before their stored summary is backfilled.
      summary: {
        ...(assessment.summary ?? {}),
        ...findingSummaryFields(findingCounts),
      },
      /*
       * Real OWASP coverage, from the check registry.
       *
       * The report previously derived its OWASP section from finding counts,
       * listing only categories where something was found. A COMPLIANCE report
       * therefore omitted API6, API9 and API10 entirely — the three categories
       * with no check behind them — leaving an auditor to conclude they were
       * tested and clean. Coverage and findings are now separate inputs.
       */
      owaspCoverage: this.registry.getOwaspCoverage(),
      findings: assessment.occurrences.map((occurrence) => ({
        id: occurrence.id,
        issueId: occurrence.issueId,
        issueStatus: occurrence.issue?.status ?? null,
        firstSeenAt: occurrence.issue?.firstSeenAt ?? occurrence.detectedAt,
        occurrenceCount: occurrence.issue?.occurrenceCount ?? 1,

        title: occurrence.titleSnapshot,
        description: occurrence.descriptionSnapshot,
        severity: occurrence.severitySnapshot,
        cvssScore: occurrence.cvssSnapshot,
        owaspCategory: occurrence.owaspSnapshot,
        cweId: occurrence.cweSnapshot,
        pluginId: occurrence.pluginIdSnapshot,
        ruleId: occurrence.ruleIdSnapshot,
        impact: occurrence.impactSnapshot,
        remediation: occurrence.remediationSnapshot,
        category: occurrence.location,
        affectedUrl: occurrence.affectedUrl,
        evidence: occurrence.evidence,
        createdAt: occurrence.detectedAt,
        endpoint:
          occurrence.endpoint ??
          { path: occurrence.pathSnapshot, method: occurrence.methodSnapshot },
        references: [] as string[],

        /**
         * AI guidance, or null. Advisory: it is rendered in its own labelled
         * block and never merged into the scanner's description or evidence.
         */
        guidance:
          occurrence.issue?.guidance?.status === 'READY'
            ? {
                ...(occurrence.issue.guidance.payload as any),
                _meta: {
                  provider: occurrence.issue.guidance.provider,
                  model: occurrence.issue.guidance.model,
                  promptVersion: occurrence.issue.guidance.promptVersion,
                  knowledgeVersion: occurrence.issue.guidance.knowledgeVersion,
                  confidence: occurrence.issue.guidance.confidence,
                  generatedAt: occurrence.issue.guidance.generatedAt,
                },
              }
            : null,
      })),
    };
  }

  generateJson(assessment: any): string {
    const output = {
      meta: {
        tool: `${appBrand.name} — ${appBrand.tagline}`,
        version: REPORT_TOOL_VERSION,
        generatedAt: new Date().toISOString(),
        assessmentId: assessment.id,
      },
      project: assessment.project,
      assessment: {
        id: assessment.id,
        status: assessment.status,
        startedAt: assessment.startedAt,
        completedAt: assessment.completedAt,
        duration: assessment.duration,
      },
      summary: assessment.summary,
      findings: assessment.findings.map((f: any) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        cvssScore: f.cvssScore,
        cvssVector: f.cvssVector,
        owaspCategory: f.owaspCategory,
        cweId: f.cweId,
        category: f.category,
        affectedUrl: f.affectedUrl,
        description: f.description,
        impact: f.impact,
        remediation: f.remediation,
        references: f.references,
        aiAnalysis: f.aiAnalysis,
        status: f.status,
      })),
    };
    return JSON.stringify(output, null, 2);
  }

  generateMarkdown(assessment: any): string {
    const { project, summary, findings } = assessment;
    const date = new Date().toISOString().split('T')[0];
    const lines: string[] = [];

    lines.push(`# ${appBrand.name} — Security Assessment Report`);
    lines.push(`**Project:** ${project.name}  `);
    lines.push(`**URL:** ${project.baseUrl}  `);
    lines.push(`**Date:** ${date}  `);
    lines.push(`**Security Score:** ${summary?.securityScore ?? 'N/A'}/100  `);
    lines.push(`**Risk Level:** ${summary?.riskLevel ?? 'N/A'}  `);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| Critical | ${summary?.criticalCount ?? 0} |`);
    lines.push(`| High     | ${summary?.highCount ?? 0} |`);
    lines.push(`| Medium   | ${summary?.mediumCount ?? 0} |`);
    lines.push(`| Low      | ${summary?.lowCount ?? 0} |`);
    lines.push(`| Info     | ${summary?.infoCount ?? 0} |`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Findings');
    lines.push('');

    const sorted = [...findings].sort(
      (a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    );

    for (const f of sorted) {
      lines.push(`### [${f.severity}] ${f.title}`);
      lines.push('');
      if (f.owaspCategory) lines.push(`**OWASP:** ${f.owaspCategory}  `);
      if (f.cvssScore) lines.push(`**CVSS:** ${f.cvssScore}  `);
      if (f.affectedUrl) lines.push(`**Affected URL:** \`${f.affectedUrl}\`  `);
      lines.push('');
      lines.push('**Description**');
      lines.push('');
      lines.push(f.description ?? '');
      lines.push('');
      if (f.impact) {
        lines.push('**Impact**');
        lines.push('');
        lines.push(f.impact);
        lines.push('');
      }
      if (f.remediation) {
        lines.push('**Remediation**');
        lines.push('');
        lines.push(f.remediation);
        lines.push('');
      }
      if (f.references?.length) {
        lines.push('**References**');
        lines.push('');
        for (const ref of f.references) lines.push(`- ${ref}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  generateSarif(assessment: any): string {
    const { project, findings } = assessment;
    const rules: Record<string, any> = {};

    for (const f of findings) {
      const ruleId = f.pluginId ?? f.owaspCategory ?? 'unknown';
      if (!rules[ruleId]) {
        rules[ruleId] = {
          id: ruleId,
          name: f.title,
          shortDescription: { text: f.title },
          fullDescription: { text: f.description ?? f.title },
          helpUri: f.references?.[0] ?? 'https://owasp.org/API-Security/',
          properties: {
            tags: [f.owaspCategory ?? 'security'],
            'security-severity': String(f.cvssScore ?? this.severityToCvss(f.severity)),
          },
        };
      }
    }

    const results = findings.map((f: any) => ({
      ruleId: f.pluginId ?? f.owaspCategory ?? 'unknown',
      level: this.severityToSarifLevel(f.severity),
      message: { text: f.description ?? f.title },
      locations: f.affectedUrl
        ? [{ physicalLocation: { artifactLocation: { uri: f.affectedUrl } } }]
        : [],
      properties: {
        cvssScore: f.cvssScore,
        cvssVector: f.cvssVector,
        cweId: f.cweId,
        owaspCategory: f.owaspCategory,
        severity: f.severity,
        remediation: f.remediation,
      },
    }));

    const sarif = {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: appBrand.name,
              version: REPORT_TOOL_VERSION,
              informationUri: appBrand.url,
              rules: Object.values(rules),
            },
          },
          automationDetails: {
            id: assessment.id,
            description: { text: `Security assessment of ${project.name}` },
          },
          results,
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }

  /**
   * The report document.
   *
   * Delegates to `report-template.ts`, which renders the dark, print-ready
   * layout shared by the PDF and HTML formats. Kept as a thin wrapper so the
   * PDF path and the HTML export can never diverge into two designs.
   */
  generateHtml(
    assessment: any,
    type: ReportType,
    options: { reportId?: string; version?: number } = {},
  ): string {
    return renderReportHtml({
      assessment,
      type,
      reportId: options.reportId,
      version: options.version,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async generatePdf(assessment: any, type: ReportType): Promise<Buffer> {
    return this.renderPdfFromHtml(this.generateHtml(assessment, type));
  }

  /**
   * Chromium print options shared by first-generation and re-render.
   *
   * Zero margins and `preferCSSPageSize` hand the entire 210×297mm sheet to the
   * document. A paper margin here would frame every page in white — which is
   * what made a full-bleed dark cover render as a dark rectangle floating on a
   * white page — and would clip the sheets the paginator composed.
   *
   * Chromium's own header/footer templates are off for the same reason: they
   * can only draw inside a paper margin that no longer exists. Running
   * furniture and page numbers are part of the document instead, so they also
   * survive into the HTML export and into any re-print of a stored snapshot.
   */
  private pdfOptions() {
    return {
      format: 'A4' as const,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    };
  }

  /**
   * Prints an already-rendered HTML document to PDF.
   *
   * Separated from `generatePdf` so a download can re-print the HTML snapshot
   * frozen with the report instead of re-reading findings from the database.
   * That is what keeps a re-render byte-identical to the document originally
   * issued, even after the underlying issues have been re-triaged.
   */
  async renderPdfFromHtml(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      executablePath: this.findBrowserExecutable(),
      headless: true,
      args: process.env.CHROMIUM_DISABLE_SANDBOX === 'true'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      /*
       * The document measures itself into pages before it is printed, so it has
       * to be measured under the conditions it will be printed in: print media
       * and an A4-wide viewport. Measuring at the default 800×600 screen size
       * would paginate against the wrong available height and leave pages
       * short or clipped.
       */
      await page.setViewport(A4_VIEWPORT);
      await page.emulateMediaType('print');
      // The document embeds its logo as a data URI and loads no webfonts, so
      // `domcontentloaded` is sufficient — there is no network to wait for.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      // The paginator is inline and synchronous, so it has already run; this
      // asserts it rather than assuming it, and fails loudly if it threw.
      await page.waitForSelector('html[data-paginated]', { timeout: 15_000 });
      const pdf = await page.pdf(this.pdfOptions());
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private findBrowserExecutable(): string {
    const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean) as string[];
    const executable = candidates.find((candidate) => existsSync(candidate));
    if (!executable) throw new Error('PDF generation requires Chromium. Set CHROMIUM_EXECUTABLE_PATH.');
    return executable;
  }

  private severityToCvss(severity: string): number {
    return { CRITICAL: 9.5, HIGH: 7.5, MEDIUM: 5.0, LOW: 3.0, INFO: 0.0 }[severity] ?? 0;
  }

  private severityToSarifLevel(severity: string): string {
    return { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note', INFO: 'none' }[severity] ?? 'none';
  }
}
