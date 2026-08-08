import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { appBrand, REPORT_TOOL_VERSION } from '../../brand/brand';
import {
  pdfFooterTemplate,
  pdfHeaderTemplate,
  renderReportHtml,
} from './report-template';

type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#22c55e', INFO: '#6b7280',
};

@Injectable()
export class ReportGeneratorService {
  constructor(private prisma: PrismaService) {}

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
            issue: { select: { id: true, status: true, firstSeenAt: true, occurrenceCount: true } },
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    return {
      ...assessment,
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
   * Header and footer come from Chromium's own templates rather than CSS,
   * because `.pageNumber` / `.totalPages` are the only way to number pages in
   * a Chromium print job — CSS page counters are not supported. The top margin
   * leaves room for the header band so it cannot overlap body text.
   */
  private pdfOptions(reportId?: string) {
    return {
      format: 'A4' as const,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: pdfHeaderTemplate(),
      footerTemplate: pdfFooterTemplate(reportId),
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
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
  async renderPdfFromHtml(html: string, reportId?: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      executablePath: this.findBrowserExecutable(),
      headless: true,
      args: process.env.CHROMIUM_DISABLE_SANDBOX === 'true'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      // The document embeds its logo as a data URI and loads no webfonts, so
      // `domcontentloaded` is sufficient — there is no network to wait for.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf(this.pdfOptions(reportId));
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

  private sevCard(severity: string, count: number): string {
    const color = SEVERITY_COLOR[severity] ?? '#6b7280';
    return `<div class="sev-card" style="border-color:${color}30;background:${color}08">
      <div class="num" style="color:${color}">${count}</div>
      <div class="label" style="color:${color}">${severity}</div>
    </div>`;
  }

  private buildOwaspTable(findings: any[]): string {
    const map: Record<string, number> = {};
    for (const f of findings) {
      if (f.owaspCategory) map[f.owaspCategory] = (map[f.owaspCategory] || 0) + 1;
    }
    if (!Object.keys(map).length) return '';
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, cnt]) => `<tr><td>${esc(cat)}</td><td>${cnt}</td></tr>`)
      .join('');
  }

  private severityToCvss(severity: string): number {
    return { CRITICAL: 9.5, HIGH: 7.5, MEDIUM: 5.0, LOW: 3.0, INFO: 0.0 }[severity] ?? 0;
  }

  private severityToSarifLevel(severity: string): string {
    return { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note', INFO: 'none' }[severity] ?? 'none';
  }
}

function esc(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
