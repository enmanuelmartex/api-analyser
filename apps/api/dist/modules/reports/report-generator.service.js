"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportGeneratorService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const node_fs_1 = require("node:fs");
const puppeteer_core_1 = require("puppeteer-core");
const plugin_registry_service_1 = require("../plugins/plugin-registry.service");
const brand_1 = require("../../brand/brand");
const report_template_1 = require("./report-template");
const assessment_finding_counts_1 = require("../assessments/assessment-finding-counts");
const A4_VIEWPORT = { width: 794, height: 1123 };
const SEVERITY_ORDER = {
    CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4,
};
let ReportGeneratorService = class ReportGeneratorService {
    constructor(prisma, registry) {
        this.prisma = prisma;
        this.registry = registry;
    }
    async getAssessmentData(assessmentId, userId) {
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
        if (!assessment)
            throw new common_1.NotFoundException('Assessment not found');
        const findingCounts = (0, assessment_finding_counts_1.countOccurrenceSeverities)(assessment.occurrences);
        return {
            ...assessment,
            summary: {
                ...(assessment.summary ?? {}),
                ...(0, assessment_finding_counts_1.findingSummaryFields)(findingCounts),
            },
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
                endpoint: occurrence.endpoint ??
                    { path: occurrence.pathSnapshot, method: occurrence.methodSnapshot },
                references: [],
                guidance: occurrence.issue?.guidance?.status === 'READY'
                    ? {
                        ...occurrence.issue.guidance.payload,
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
    generateJson(assessment) {
        const output = {
            meta: {
                tool: `${brand_1.appBrand.name} — ${brand_1.appBrand.tagline}`,
                version: brand_1.REPORT_TOOL_VERSION,
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
            findings: assessment.findings.map((f) => ({
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
    generateMarkdown(assessment) {
        const { project, summary, findings } = assessment;
        const date = new Date().toISOString().split('T')[0];
        const lines = [];
        lines.push(`# ${brand_1.appBrand.name} — Security Assessment Report`);
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
        const sorted = [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
        for (const f of sorted) {
            lines.push(`### [${f.severity}] ${f.title}`);
            lines.push('');
            if (f.owaspCategory)
                lines.push(`**OWASP:** ${f.owaspCategory}  `);
            if (f.cvssScore)
                lines.push(`**CVSS:** ${f.cvssScore}  `);
            if (f.affectedUrl)
                lines.push(`**Affected URL:** \`${f.affectedUrl}\`  `);
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
                for (const ref of f.references)
                    lines.push(`- ${ref}`);
                lines.push('');
            }
            lines.push('---');
            lines.push('');
        }
        return lines.join('\n');
    }
    generateSarif(assessment) {
        const { project, findings } = assessment;
        const rules = {};
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
        const results = findings.map((f) => ({
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
                            name: brand_1.appBrand.name,
                            version: brand_1.REPORT_TOOL_VERSION,
                            informationUri: brand_1.appBrand.url,
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
    generateHtml(assessment, type, options = {}) {
        return (0, report_template_1.renderReportHtml)({
            assessment,
            type,
            reportId: options.reportId,
            version: options.version,
        });
    }
    async generatePdf(assessment, type) {
        return this.renderPdfFromHtml(this.generateHtml(assessment, type));
    }
    pdfOptions() {
        return {
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        };
    }
    async renderPdfFromHtml(html) {
        const browser = await puppeteer_core_1.default.launch({
            executablePath: this.findBrowserExecutable(),
            headless: true,
            args: process.env.CHROMIUM_DISABLE_SANDBOX === 'true'
                ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                : ['--disable-dev-shm-usage'],
        });
        try {
            const page = await browser.newPage();
            await page.setViewport(A4_VIEWPORT);
            await page.emulateMediaType('print');
            await page.setContent(html, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('html[data-paginated]', { timeout: 15_000 });
            const pdf = await page.pdf(this.pdfOptions());
            return Buffer.from(pdf);
        }
        finally {
            await browser.close();
        }
    }
    findBrowserExecutable() {
        const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
        const executable = candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate));
        if (!executable)
            throw new Error('PDF generation requires Chromium. Set CHROMIUM_EXECUTABLE_PATH.');
        return executable;
    }
    severityToCvss(severity) {
        return { CRITICAL: 9.5, HIGH: 7.5, MEDIUM: 5.0, LOW: 3.0, INFO: 0.0 }[severity] ?? 0;
    }
    severityToSarifLevel(severity) {
        return { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note', INFO: 'none' }[severity] ?? 'none';
    }
};
exports.ReportGeneratorService = ReportGeneratorService;
exports.ReportGeneratorService = ReportGeneratorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_registry_service_1.PluginRegistryService])
], ReportGeneratorService);
//# sourceMappingURL=report-generator.service.js.map