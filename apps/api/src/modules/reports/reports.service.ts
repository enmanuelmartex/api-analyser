import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';
import {
  GENERATOR_VERSION,
  REPORT_FORMATS,
  buildFileName,
  buildStoredFileName,
  contentTypeFor,
  isBinaryFormat,
  type ReportFormat,
  type ReportType,
} from './report-artifact';
import {
  averageScore,
  averageScoreDelta,
  buildTrend,
  sumSeverities,
  trendDelta,
  type ReportedAssessment,
} from './report-metrics';
import {
  countOccurrenceSeverities,
  findingSummaryFields,
} from '../assessments/assessment-finding-counts';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

const TREND_WINDOW_DAYS = 30;

export interface ResolvedArtifact {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  /** True when the bytes were re-rendered from the stored snapshot rather than read from disk. */
  rehydrated: boolean;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private generator: ReportGeneratorService,
    private storage: ReportStorageService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────────

  /**
   * The reports list.
   *
   * Only the latest version of each (assessment, type, format) is returned.
   * Historical versions still exist — a deliberate "Regenerate" mints one, and
   * the pre-fix duplicates were versioned rather than deleted by the artifacts
   * migration — but showing every one of them is what made the list look like it
   * held duplicate rows. `includeHistory` opts back in.
   */
  async findAll(userId: string, options: { assessmentId?: string; includeHistory?: boolean } = {}) {
    const reports = await this.prisma.report.findMany({
      where: {
        assessment: { project: { userId } },
        ...(options.assessmentId ? { assessmentId: options.assessmentId } : {}),
      },
      include: {
        assessment: {
          select: {
            id: true,
            completedAt: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
    });

    const visible = options.includeHistory ? reports : this.latestVersionsOnly(reports);
    return visible.map((report) => this.withArtifactState(report));
  }

  /** Keeps one row per (assessment, type, format): the highest version. */
  private latestVersionsOnly<T extends { assessmentId: string; type: string; format: string; version: number }>(
    reports: T[],
  ): T[] {
    const latest = new Map<string, T>();
    for (const report of reports) {
      const key = `${report.assessmentId}:${report.type}:${report.format}`;
      const held = latest.get(key);
      if (!held || report.version > held.version) latest.set(key, report);
    }
    // Preserve the incoming order (newest generation first).
    return reports.filter((report) => latest.get(`${report.assessmentId}:${report.type}:${report.format}`) === report);
  }

  /**
   * A report and everything its detail page renders.
   *
   * The assessment is included with its stored summary and its occurrence
   * snapshots — the scan's own record — so the page shows what the report said
   * when it was issued, not a recomputation against today's issue triage.
   */
  async findOne(id: string, userId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, assessment: { project: { userId } } },
      include: {
        assessment: {
          select: {
            id: true,
            status: true,
            completedAt: true,
            duration: true,
            project: { select: { id: true, name: true } },
            summary: true,
            occurrences: {
              orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
              include: { issue: { select: { id: true, status: true } } },
            },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    const findingCounts = countOccurrenceSeverities(report.assessment.occurrences);
    const assessment = {
      ...report.assessment,
      findingCounts,
      summary: report.assessment.summary
        ? { ...report.assessment.summary, ...findingSummaryFields(findingCounts) }
        : report.assessment.summary,
    };

    return {
      ...this.withArtifactState(report),
      assessment,
      /**
       * Every format of this assessment + report type, present or not, so the
       * detail page can label each one "Download" or "Generate" without
       * guessing — and never offer "Download" for something that was never made.
       */
      formats: await this.formatAvailability(report.assessmentId, report.type as ReportType),
    };
  }

  async findByAssessment(assessmentId: string, userId: string) {
    await this.assertAssessmentAccess(assessmentId, userId);
    return this.findAll(userId, { assessmentId });
  }

  /**
   * Availability of each format for one (assessment, type) bundle.
   *
   * `status` drives the UI verb: an artifact that exists is downloadable, one
   * that was recorded without any stored bytes needs regenerating, and one that
   * was never generated is offered as "Generate".
   */
  async formatAvailability(assessmentId: string, type: ReportType) {
    const existing = await this.prisma.report.findMany({
      where: { assessmentId, type: type as any },
      orderBy: { version: 'desc' },
    });

    return REPORT_FORMATS.map((format) => {
      const report = existing.find((candidate) => candidate.format === format);
      if (!report) {
        return { format, status: 'MISSING' as const, reportId: null, fileSize: null, generatedAt: null, version: null };
      }
      const state = this.artifactState(report);
      return {
        format,
        status: state === 'READY' ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
        reportId: report.id,
        fileSize: report.fileSize,
        generatedAt: report.generatedAt,
        version: report.version,
      };
    });
  }

  /** Whether a row can actually be served, as opposed to merely existing. */
  private artifactState(report: { filePath: string | null; sourceSnapshot: string | null }): 'READY' | 'EMPTY' {
    return report.filePath || report.sourceSnapshot ? 'READY' : 'EMPTY';
  }

  /**
   * Adds `isDownloadable` and strips the snapshot from list/detail payloads.
   *
   * The snapshot is a whole rendered document; sending it with every row of the
   * table would be megabytes of JSON, and it is already available byte-for-byte
   * through the download endpoint.
   */
  private withArtifactState<T extends { filePath: string | null; sourceSnapshot: string | null }>(report: T) {
    const { sourceSnapshot, ...rest } = report;
    return {
      ...rest,
      isDownloadable: this.artifactState(report) === 'READY',
    };
  }

  // ── Generation ──────────────────────────────────────────────────────────────

  /**
   * Creates a report artifact — the only operation that may insert a `Report`.
   *
   * Idempotent by default: asking for a (assessment, type, format) that already
   * exists returns the existing row untouched, so a double-clicked button, a
   * retried request or two concurrent callers all converge on one artifact and
   * one `generatedAt`. `regenerate` is the explicit opt-in that mints version+1.
   */
  async generate(
    assessmentId: string,
    userId: string,
    options: { type: ReportType; format: ReportFormat; regenerate?: boolean },
  ) {
    const { type, format, regenerate = false } = options;

    if (!regenerate) {
      const existing = await this.prisma.report.findFirst({
        where: { assessmentId, type: type as any, format: format as any, assessment: { project: { userId } } },
        orderBy: { version: 'desc' },
      });
      // An existing row with no bytes behind it is a pre-fix record: fall
      // through and render its artifact in place rather than handing back
      // something that cannot be downloaded.
      if (existing && this.artifactState(existing) === 'READY') {
        return { report: this.withArtifactState(existing), created: false };
      }
      if (existing) {
        const filled = await this.renderInto(existing.id, assessmentId, userId, type, format);
        return { report: filled, created: false };
      }
    }

    const assessment = await this.generator.getAssessmentData(assessmentId, userId);
    const projectName = (assessment.project as any)?.name ?? 'Report';
    const generatedAt = new Date();

    const nextVersion = regenerate
      ? ((
          await this.prisma.report.aggregate({
            where: { assessmentId, type: type as any, format: format as any },
            _max: { version: true },
          })
        )._max.version ?? 0) + 1
      : 1;

    const snapshot = this.renderSnapshot(assessment, type, format, { version: nextVersion });

    let report;
    try {
      report = await this.prisma.report.create({
        data: {
          assessmentId,
          type: type as any,
          format: format as any,
          version: nextVersion,
          title: this.buildTitle(projectName, type, generatedAt, nextVersion),
          sourceSnapshot: snapshot,
          generatorVersion: GENERATOR_VERSION,
          generatedAt,
        } as any,
      });
    } catch (error: any) {
      // Two concurrent generations raced to insert the same artifact. The loser
      // adopts the winner's row instead of creating a duplicate.
      if (error?.code === UNIQUE_VIOLATION) {
        const winner = await this.prisma.report.findFirst({
          where: { assessmentId, type: type as any, format: format as any, version: nextVersion },
        });
        if (winner) return { report: this.withArtifactState(winner), created: false };
      }
      throw error;
    }

    const materialised = await this.materialise(report, projectName, snapshot);
    return { report: this.withArtifactState(materialised), created: true };
  }

  /**
   * Fills in the artifact of a row that has none.
   *
   * Used for reports recorded before artifacts were persisted. The row keeps its
   * id and its `generatedAt`, so links and history stay valid — only the missing
   * bytes are added.
   */
  private async renderInto(
    reportId: string,
    assessmentId: string,
    userId: string,
    type: ReportType,
    format: ReportFormat,
  ) {
    const assessment = await this.generator.getAssessmentData(assessmentId, userId);
    const projectName = (assessment.project as any)?.name ?? 'Report';
    const report = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    const snapshot = this.renderSnapshot(assessment, type, format, {
      reportId: report.id,
      version: report.version,
    });
    const materialised = await this.materialise(report, projectName, snapshot);
    return this.withArtifactState(materialised);
  }

  /**
   * The frozen document source for a format. PDFs store the HTML they print from.
   *
   * The identity of the artifact — its report id and version — is baked into
   * the document rather than passed to the printer, because a re-print reads
   * only the stored snapshot and would otherwise lose the reference printed in
   * the page footer.
   */
  private renderSnapshot(
    assessment: any,
    type: ReportType,
    format: ReportFormat,
    identity: { reportId?: string; version?: number } = {},
  ): string {
    switch (format) {
      case 'JSON':
        return this.generator.generateJson(assessment);
      case 'MARKDOWN':
        return this.generator.generateMarkdown(assessment);
      case 'SARIF':
        return this.generator.generateSarif(assessment);
      case 'PDF':
      case 'HTML':
      default:
        return this.generator.generateHtml(assessment, type, identity);
    }
  }

  /**
   * Writes the artifact and records its name, size and checksum.
   *
   * A PDF whose Chromium render fails still keeps its HTML snapshot, so the
   * report remains downloadable once a browser is available rather than being
   * lost — the failure is logged, not propagated into a broken row.
   */
  private async materialise(report: any, projectName: string, snapshot: string) {
    const format = report.format as ReportFormat;
    const fileName = buildFileName({
      projectName,
      type: report.type as ReportType,
      format,
      generatedAt: report.generatedAt,
      version: report.version,
    });

    let filePath: string | null = null;
    let fileSize = Buffer.byteLength(snapshot, 'utf8');
    let checksum = ReportStorageService.checksum(snapshot);

    if (isBinaryFormat(format)) {
      try {
        const bytes = await this.generator.renderPdfFromHtml(snapshot);
        filePath = await this.storage.write(buildStoredFileName(report.id, format), bytes);
        fileSize = bytes.length;
        checksum = ReportStorageService.checksum(bytes);
      } catch (error) {
        this.logger.warn(
          `PDF render failed for report ${report.id}; the HTML snapshot was kept and the PDF will be produced on download. ${(error as Error).message}`,
        );
      }
    }

    return this.prisma.report.update({
      where: { id: report.id },
      data: {
        fileName,
        filePath,
        fileSize,
        checksum,
        sourceSnapshot: snapshot,
        // Stamped here rather than only at insert, so a legacy record whose
        // artifact is filled in place also records which generator built the
        // bytes it now serves.
        generatorVersion: GENERATOR_VERSION,
      } as any,
    });
  }

  private buildTitle(projectName: string, type: ReportType, generatedAt: Date, version: number): string {
    const label = type.charAt(0) + type.slice(1).toLowerCase();
    const date = generatedAt.toISOString().split('T')[0];
    const revision = version > 1 ? ` (v${version})` : '';
    return `${label} report — ${projectName} — ${date}${revision}`;
  }

  // ── Download ────────────────────────────────────────────────────────────────

  /**
   * Resolves the bytes of an ALREADY GENERATED report.
   *
   * This never writes to the `Report` table, never touches `generatedAt`, and
   * never reads the current findings. Ownership is proven from the report id
   * against the caller, not from anything the client sends alongside it.
   *
   * Resolution order:
   *   1. the stored binary, when the checksum still matches;
   *   2. the frozen source snapshot — replayed as-is for text formats, or
   *      re-printed to PDF for binary ones.
   *
   * Step 2 is a re-render, not a regeneration: it consumes the snapshot captured
   * at issue time, so the document is identical to the one first delivered.
   */
  async resolveArtifact(reportId: string, userId: string): Promise<ResolvedArtifact> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, assessment: { project: { userId } } },
      include: { assessment: { select: { project: { select: { name: true } } } } },
    });
    if (!report) throw new NotFoundException('Report not found');

    const format = report.format as ReportFormat;
    const fileName =
      report.fileName ??
      buildFileName({
        projectName: report.assessment?.project?.name ?? 'report',
        type: report.type as ReportType,
        format,
        generatedAt: report.generatedAt,
        version: report.version,
      });

    if (report.filePath) {
      const bytes = await this.storage.read(report.filePath);
      if (bytes && (!report.checksum || ReportStorageService.checksum(bytes) === report.checksum)) {
        return { bytes, contentType: contentTypeFor(format), fileName, rehydrated: false };
      }
      this.logger.warn(`Stored artifact for report ${reportId} is missing or altered; re-rendering from its snapshot.`);
    }

    if (!report.sourceSnapshot) {
      throw new UnprocessableEntityException(
        'This report has no stored artifact. Regenerate it to produce a downloadable file.',
      );
    }

    if (!isBinaryFormat(format)) {
      return {
        bytes: Buffer.from(report.sourceSnapshot, 'utf8'),
        contentType: contentTypeFor(format),
        fileName,
        rehydrated: true,
      };
    }

    let bytes: Buffer;
    try {
      bytes = await this.generator.renderPdfFromHtml(report.sourceSnapshot);
    } catch (error) {
      // The snapshot is intact but this host cannot print it. Say so plainly
      // and stop: the caller asked for a specific existing artifact, and
      // substituting a different format — or quietly generating a new report —
      // would be answering a question they did not ask.
      this.logger.error(
        `Could not re-render PDF for report ${report.id}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'This PDF could not be rebuilt because no PDF renderer is available on the server. ' +
          'Install Chromium or set CHROMIUM_EXECUTABLE_PATH, or download this report in another format.',
      );
    }

    // Repair the cache for next time. This updates artifact bookkeeping only —
    // no new row, and `generatedAt` is untouched.
    await this.storage
      .write(buildStoredFileName(report.id, format), bytes)
      .then((stored) =>
        stored
          ? this.prisma.report.update({
              where: { id: report.id },
              data: { filePath: stored, fileSize: bytes.length, checksum: ReportStorageService.checksum(bytes) } as any,
            })
          : null,
      )
      .catch(() => null);

    return { bytes, contentType: contentTypeFor(format), fileName, rehydrated: true };
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  /**
   * Metrics for the Reports screen.
   *
   * Scoped to assessments that produced a report, and counted once per
   * assessment. See `report-metrics.ts` for why.
   */
  async getStats(userId: string) {
    const [reportRows, projects, completedAssessments] = await Promise.all([
      this.prisma.report.findMany({
        where: { assessment: { project: { userId } } },
        select: {
          id: true,
          assessmentId: true,
          type: true,
          format: true,
          version: true,
          generatedAt: true,
        },
      }),
      this.prisma.project.count({ where: { userId, isActive: true } }),
      this.prisma.assessment.findMany({
        where: { project: { userId }, status: 'COMPLETED' },
        select: {
          id: true,
          projectId: true,
          completedAt: true,
          createdAt: true,
          summary: { select: { securityScore: true } },
        },
      }),
    ]);

    const latestReports = this.latestVersionsOnly(reportRows as any[]);
    const reportedIds = new Set(latestReports.map((report) => report.assessmentId));

    // One grouped query, not one per assessment. Occurrences are the source of
    // truth for "what did this scan detect" — the summary counters can be stale
    // on seeded or pre-aggregation data.
    const occurrenceGroups = reportedIds.size
      ? await this.prisma.findingOccurrence.groupBy({
          by: ['assessmentId', 'severitySnapshot'],
          where: { assessmentId: { in: [...reportedIds] } },
          _count: { _all: true },
        })
      : [];

    const countsByAssessment = new Map<
      string,
      { critical: number; high: number; medium: number; low: number; info: number; total: number }
    >();
    for (const group of occurrenceGroups) {
      const counts =
        countsByAssessment.get(group.assessmentId) ??
        { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
      const n = group._count._all;
      counts.total += n;
      const bucket = group.severitySnapshot.toLowerCase() as keyof typeof counts;
      if (bucket in counts && bucket !== 'total') counts[bucket] += n;
      countsByAssessment.set(group.assessmentId, counts);
    }

    const reported: ReportedAssessment[] = completedAssessments
      .filter((assessment) => reportedIds.has(assessment.id))
      .map((assessment) => {
        const counts = countsByAssessment.get(assessment.id) ?? {
          critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0,
        };
        return {
          id: assessment.id,
          projectId: assessment.projectId,
          completedAt: assessment.completedAt ?? assessment.createdAt,
          securityScore: assessment.summary?.securityScore ?? null,
          ...counts,
        };
      });

    const severities = sumSeverities(reported);
    const { avgSecurityScore, scoredAssessments } = averageScore(reported);
    const trend = buildTrend(reported, TREND_WINDOW_DAYS);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - TREND_WINDOW_DAYS);

    /*
     * Field names say what is being counted.
     *
     * The previous shape used `totalReports`, `totalProjects` and `scans`, which
     * read as platform-wide totals but were scoped to reports — so the same word
     * meant a different thing here than on the Dashboard, and no caller could
     * tell which. Every name below states its unit (artifact / assessment /
     * project) and, where it matters, whether superseded rows are included.
     */
    return {
      // ── Artifacts ────────────────────────────────────────────────────────
      // One row per (assessment, type, format). "Active" is the latest version;
      // superseded rows are earlier versions of the same artifact.
      activeReportArtifacts: latestReports.length,
      supersededReportArtifacts: reportRows.length - latestReports.length,
      activeArtifactsLast30Days: latestReports.filter((r) => r.generatedAt >= windowStart).length,

      // ── Coverage — distinct entities, never multiplied by format ─────────
      distinctAssessmentsWithReports: reported.length,
      totalCompletedAssessments: completedAssessments.length,
      distinctProjectsCovered: new Set(reported.map((a) => a.projectId)).size,
      totalActiveProjects: projects,

      // ── Score — one value per assessment, all time ───────────────────────
      averageAssessmentScore: avgSecurityScore,
      scoredAssessmentsInAverage: scoredAssessments,
      // 30 days vs the 30 immediately before. Null when either window is empty.
      averageScoreDelta: averageScoreDelta(reported, TREND_WINDOW_DAYS),

      // ── Findings included, deduplicated per assessment ───────────────────
      criticalFindingsIncluded: severities.criticalCount,
      highFindingsIncluded: severities.highCount,
      mediumFindingsIncluded: severities.mediumCount,
      lowFindingsIncluded: severities.lowCount,
      infoFindingsIncluded: severities.infoCount,
      totalFindingsIncluded: severities.totalFindings,
      criticalHighFindingsIncluded: severities.criticalCount + severities.highCount,

      // ── Trend ────────────────────────────────────────────────────────────
      // Findings detected in completed scans that produced reports, by scan day.
      // Each severity is an independent daily count — NOT a running total.
      vulnerabilityTrend: trend,
      vulnerabilityTrendDelta: trendDelta(trend),
      trendWindowDays: TREND_WINDOW_DAYS,
    };
  }

  // ── Deletion ────────────────────────────────────────────────────────────────

  /**
   * Deletes a report and only its own artifact.
   *
   * The stored file name is derived from the report id and re-validated by the
   * storage service, so this cannot reach a file outside the report store.
   */
  async remove(id: string, userId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, assessment: { project: { userId } } },
    });
    if (!report) throw new NotFoundException('Report not found');

    await this.prisma.report.delete({ where: { id } });
    await this.storage.delete(report.filePath);
    return { message: 'Report deleted' };
  }

  private async assertAssessmentAccess(assessmentId: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, project: { userId } },
      select: { id: true },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }
}
