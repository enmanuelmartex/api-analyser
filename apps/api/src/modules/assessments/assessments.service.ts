import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { concat, Observable, of, Subject } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { ScoringService } from '../scoring/scoring.service';
import { RunAssessmentDto } from './dto/run-assessment.dto';
import {
  countOccurrenceSeverities,
  emptyFindingCounts,
  findingSummaryFields,
  foldOccurrenceCounts,
  type FindingCounts,
} from './assessment-finding-counts';

/** Default page size for the project-detail "Recent assessments" list. */
const PROJECT_ASSESSMENTS_PAGE_SIZE = 5;
/** Upper bound so a caller cannot ask for an unbounded page. */
const MAX_PAGE_SIZE = 50;

/**
 * Why this run exists, supplied by whatever asked for it.
 *
 * Optional, and absent for every manual run — the "Run Assessment" button knows
 * nothing about it. When a schedule is behind the run, this is what stops the
 * audit trail from claiming a person pressed a button at 02:00: the events
 * carry `initiatedBy: SCHEDULER`, and the audit writer attributes the run to
 * the scheduler rather than to the project's owner, whose account the scan
 * legitimately runs under so that their check configuration applies.
 */
export interface ScanProvenance {
  trigger: 'MANUAL' | 'SCHEDULED';
  scheduleId?: string;
  scheduleName?: string;
  /** SCHEDULER for an automatic run; USER for "Run now" on a schedule. */
  initiatedBy?: 'SCHEDULER' | 'USER';
  /** The person behind a "Run now", when there is one. */
  actorId?: string;
}

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);
  private progressSubjects = new Map<string, Subject<MessageEvent>>();

  constructor(
    private prisma: PrismaService,
    @InjectQueue('scanner') private scannerQueue: Queue,
    private eventEmitter: EventEmitter2,
    private pluginRegistry: PluginRegistryService,
    private scoring: ScoringService,
  ) {
    this.eventEmitter.on('scanner.progress', (data) => {
      this.emitProgress(data.assessmentId, data);
    });
  }

  async findAll(userId: string, projectId?: string) {
    const assessments = await this.prisma.assessment.findMany({
      where: {
        project: { userId },
        ...(projectId ? { projectId } : {}),
      },
      include: {
        project: { select: { id: true, name: true, baseUrl: true } },
        summary: true,
        // Detections belonging to this scan. Not the project's issue count:
        // a scan reports what it observed, the project reports what is open.
        _count: { select: { occurrences: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.withFindingCounts(assessments);
  }

  /**
   * A project's assessments, newest first, one page at a time.
   *
   * Server-side pagination (skip/take + count) rather than fetching every scan
   * and slicing in the browser: a project can accumulate hundreds of scans. The
   * `project: { userId }` scope both filters by project and enforces ownership,
   * so another user's project simply returns an empty page.
   */
  async findByProjectPaginated(
    userId: string,
    projectId: string,
    page = 1,
    pageSize = PROJECT_ASSESSMENTS_PAGE_SIZE,
  ) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(pageSize) || PROJECT_ASSESSMENTS_PAGE_SIZE),
    );
    const where = { projectId, project: { userId } };

    const [total, rows] = await Promise.all([
      this.prisma.assessment.count({ where }),
      this.prisma.assessment.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, baseUrl: true } },
          summary: true,
          _count: { select: { occurrences: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
    ]);

    return {
      data: await this.withFindingCounts(rows),
      page: safePage,
      pageSize: safeSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    };
  }

  /**
   * Attaches occurrence-derived `findingCounts` to each assessment.
   *
   * The counts are the source of truth for the Critical / High / Total columns,
   * computed from the real `FindingOccurrence` rows rather than the persisted
   * summary counters (which may be zero for demo/seed or pre-aggregation data).
   * A single grouped query covers the whole page, so there is no N+1.
   */
  private async withFindingCounts<T extends { id: string }>(
    assessments: T[],
  ): Promise<(T & { findingCounts: FindingCounts })[]> {
    const counts = await this.findingCountsFor(assessments.map((a) => a.id));
    return assessments.map((assessment) => ({
      ...assessment,
      findingCounts: counts.get(assessment.id) ?? emptyFindingCounts(),
    }));
  }

  /** One grouped query → `assessmentId → FindingCounts`, never one query per row. */
  private async findingCountsFor(
    assessmentIds: string[],
  ): Promise<Map<string, FindingCounts>> {
    if (!assessmentIds.length) return new Map();
    const groups = await this.prisma.findingOccurrence.groupBy({
      by: ['assessmentId', 'severitySnapshot'],
      where: { assessmentId: { in: assessmentIds } },
      _count: { _all: true },
    });
    return foldOccurrenceCounts(groups);
  }

  async findOne(id: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, project: { userId } },
      include: {
        project: { select: { id: true, name: true, baseUrl: true, environment: true } },
        // Named so the scan detail can say "triggered by Weekly Production
        // Scan" and link back to it. Null for a manual run, and also null once
        // the schedule has been deleted — the scan outlives its schedule.
        schedule: { select: { id: true, name: true } },
        config: true,
        summary: true,
        // This scan's detections, each linked to the persistent issue it
        // belongs to so the UI can offer "open the issue" from a scan result.
        occurrences: {
          orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
          include: {
            issue: {
              select: {
                id: true,
                status: true,
                firstSeenAt: true,
                lastSeenAt: true,
                occurrenceCount: true,
                reopenCount: true,
              },
            },
          },
        },
        reports: true,
        logs: {
          orderBy: { timestamp: 'asc' },
          take: 500,
        },
      },
    });

    if (!assessment) throw new NotFoundException('Assessment not found');
    const findingCounts = countOccurrenceSeverities(assessment.occurrences);
    return {
      ...assessment,
      findingCounts,
      // Historical summaries may have counted raw detections before identity
      // normalisation collapsed duplicates. The detail response describes the
      // occurrence list it returns, so its finding fields come from that list.
      summary: assessment.summary
        ? { ...assessment.summary, ...findingSummaryFields(findingCounts) }
        : assessment.summary,
    };
  }

  /**
   * Creates an assessment and queues it. The one entry point into the scanner.
   *
   * `provenance` is the only concession to scheduling, and it is metadata: a
   * scheduled run takes exactly this path, produces an ordinary `Assessment`,
   * and is picked up by the same worker with the same configuration resolution.
   * There is no second pipeline to keep in step.
   */
  async createAndRun(
    projectId: string,
    userId: string,
    config: RunAssessmentDto = {},
    provenance?: ScanProvenance,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        apiSpec: {
          include: { authConfig: true, endpoints: true },
        },
      },
    });

    if (!project) throw new ForbiddenException('Project not found or access denied');
    if (project.status !== 'READY') {
      throw new BadRequestException('Complete project setup before running an assessment');
    }
    if (!project.apiSpec) {
      throw new BadRequestException('Please import an OpenAPI specification before running an assessment');
    }
    if (!project.apiSpec.endpoints.length) {
      throw new BadRequestException('No endpoints found in the API specification');
    }

    const executionMode = config.executionMode ?? 'all';
    const enabledPlugins = await this.pluginRegistry.getEnabledForUser(userId);
    const enabledIds = new Set(enabledPlugins.map((plugin) => plugin.manifest.id));
    let profileId: string | null = null;
    let requestedIds: string[];

    if (executionMode === 'profile') {
      if (!config.scanProfileId) throw new BadRequestException('Select a scan profile');
      const profile = await this.prisma.scanProfile.findFirst({
        where: {
          id: config.scanProfileId,
          OR: [{ isSystem: true }, { userId }],
        },
      });
      if (!profile) throw new BadRequestException('The selected scan profile is not available');
      if (!profile.enabledPlugins.length) throw new BadRequestException('The selected scan profile has no plugins');
      profileId = profile.id;
      requestedIds = profile.enabledPlugins;
    } else if (executionMode === 'manual') {
      requestedIds = [...new Set(config.manualPlugins ?? [])];
      if (!requestedIds.length) throw new BadRequestException('Select at least one plugin');
    } else {
      requestedIds = [...enabledIds];
    }

    const unknownIds = requestedIds.filter((id) => !this.pluginRegistry.has(id));
    if (unknownIds.length) throw new BadRequestException('One or more selected plugins are not available');

    const resolvedPlugins = requestedIds.filter((id) => enabledIds.has(id));
    if (!resolvedPlugins.length) {
      throw new BadRequestException(
        executionMode === 'all'
          ? 'Enable at least one plugin before running an assessment'
          : 'None of the selected plugins are currently enabled',
      );
    }

    const assessment = await this.prisma.assessment.create({
      data: {
        projectId,
        status: 'QUEUED',
        trigger: provenance?.trigger ?? 'MANUAL',
        scheduleId: provenance?.scheduleId ?? null,
        config: {
          create: {
            executionMode,
            scanProfileId:          profileId,
            manualPlugins:          executionMode === 'manual' ? requestedIds : [],
            resolvedPlugins,
            enableAiAnalysis:       config.enableAiAnalysis       ?? true,
            maxRequestsPerEndpoint: config.maxRequestsPerEndpoint ?? 10,
            requestDelayMs:         config.requestDelayMs         ?? 200,
            timeoutMs:              config.timeoutMs              ?? 10000,
          } as any,
        },
      },
      include: { config: true },
    });

    const job = await this.scannerQueue.add(
      'run-assessment',
      {
        assessmentId: assessment.id,
        projectId,
        specId: project.apiSpec.id,
        userId,               // required for per-user plugin enable/disable
        // Carried through the queue so the worker's own events (`scan.started`,
        // `scan.completed`, `scan.failed`) can be attributed to the schedule
        // without the worker having to read the assessment back to find out.
        trigger: provenance?.trigger ?? 'MANUAL',
        scheduleId: provenance?.scheduleId,
        scheduleName: provenance?.scheduleName,
      },
      { jobId: `assessment-${assessment.id}` },
    );

    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: { jobId: job.id as string, status: 'QUEUED' },
    });

    this.logger.log(`Assessment ${assessment.id} queued (job: ${job.id})`);

    // The run is now visible to an operator from the moment it is accepted,
    // rather than only when the worker reports an outcome minutes later.
    this.eventEmitter.emit('scan.queued', {
      assessmentId: assessment.id,
      projectId,
      projectName: project.name,
      userId,
      endpointCount: project.apiSpec.endpoints.length,
      pluginCount: resolvedPlugins.length,
      executionMode,
      trigger: provenance?.trigger ?? 'MANUAL',
      scheduleId: provenance?.scheduleId,
      scheduleName: provenance?.scheduleName,
    });

    return assessment;
  }

  async cancel(id: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, project: { userId } },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    /*
     * Take the job out of the queue if it has not started.
     *
     * BullMQ refuses to remove a job another worker holds a lock on, and threw
     * straight out of this method — so pressing "Cancel scan" on a scan that
     * was actually running returned a 500 and cancelled nothing, which is the
     * only moment anyone presses it. An active job cannot be yanked out from
     * under its worker, so it is discarded instead (no retries) and the worker
     * stops by itself at its next checkpoint, where it reads the status this
     * method is about to write.
     */
    if (assessment.jobId) {
      const job = await this.scannerQueue.getJob(assessment.jobId);
      if (job) {
        try {
          await job.remove();
        } catch (err) {
          this.logger.log(
            `Assessment ${id} is already running; signalling the worker to stop (${(err as Error).message})`,
          );
          // Synchronous in BullMQ: it only sets the flag that stops this job
          // being retried. The DB status below is what actually stops the run.
          job.discard();
        }
      }
    }

    const cancelled = await this.prisma.assessment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    this.eventEmitter.emit('scan.cancelled', {
      assessmentId: id,
      projectId: assessment.projectId,
      projectName: assessment.project?.name ?? assessment.projectId,
      userId,
      progress: assessment.progress,
      currentStep: assessment.currentStep,
    });

    return cancelled;
  }

  async streamProgress(assessmentId: string, userId: string): Promise<Observable<MessageEvent>> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, project: { userId } },
      select: { id: true, status: true, progress: true, currentStep: true },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const subject = new Subject<MessageEvent>();
    this.progressSubjects.set(assessmentId, subject);

    setTimeout(() => {
      if (this.progressSubjects.has(assessmentId)) {
        this.progressSubjects.get(assessmentId)?.complete();
        this.progressSubjects.delete(assessmentId);
      }
    }, 10 * 60 * 1000);

    const initial = {
      data: {
        assessmentId,
        step: assessment.currentStep ?? assessment.status,
        message: assessment.currentStep ?? assessment.status,
        progress: assessment.progress,
        completed: assessment.status === 'COMPLETED',
        error: assessment.status === 'FAILED' ? assessment.currentStep ?? 'Assessment failed' : undefined,
      },
    } as MessageEvent;

    return concat(of(initial), subject.asObservable());
  }

  private emitProgress(assessmentId: string, data: any) {
    const subject = this.progressSubjects.get(assessmentId);
    if (subject) {
      subject.next({ data } as MessageEvent);
    }
  }

  async getDashboardStats(userId: string) {
    // The two counts below were bound to swapped names, so the Dashboard
    // reported the assessment total as "Projects" and the project total as
    // "Assessments". Order now matches the destructuring.
    const [projects, totalAssessmentCount, assessments, findings] = await Promise.all([
      this.prisma.project.count({ where: { userId, isActive: true } }),
      // Real total, separate from the recent-scans window below.
      this.prisma.assessment.count({ where: { project: { userId } } }),
      this.prisma.assessment.findMany({
        where: { project: { userId }, status: 'COMPLETED' },
        include: { summary: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Current risk, from persistent issues — NOT from every occurrence ever
      // recorded. Counting occurrences made the dashboard totals grow with each
      // rescan even when nothing about the API had changed.
      //
      // Excludes RESOLVED and FALSE_POSITIVE. ACCEPTED_RISK is deliberately
      // included: accepting a risk is a business decision, not a fix, so the
      // vulnerability still exists.
      this.prisma.securityIssue.groupBy({
        by: ['severity'],
        where: {
          project: { userId, isActive: true },
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK'] },
        },
        _count: { severity: true },
      }),
    ]);

    const findingsBySeverity = findings.reduce(
      (acc, f) => {
        const key = f.severity.toLowerCase();
        acc[key] = (acc[key] || 0) + (f as any)._count.severity;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Global posture: one score per PROJECT, from that project's most recent
    // scorable scan — not an average over the last N scans.
    //
    // The previous implementation averaged the last 10 completed assessments
    // with a `?? 100` fallback, so a project scanned ten times drowned out every
    // other project, a scan with no summary counted as perfect, and a user with
    // no scans at all saw 100/100. Unassessed is now `null`, never 100.
    const postures = await Promise.all(
      (await this.prisma.project.findMany({
        where: { userId, isActive: true },
        select: { id: true },
      })).map((project) => this.scoring.getProjectPosture(project.id)),
    );

    const scored = postures
      .map((posture) => posture.currentSecurityScore)
      .filter((score): score is number => typeof score === 'number');

    return {
      totalProjects: projects,
      // The real total, not the size of the recent window.
      totalAssessments: totalAssessmentCount,
      avgSecurityScore:
        scored.length > 0
          ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
          : null,
      scoredProjects: scored.length,
      unassessedProjects: postures.length - scored.length,
      findings: findingsBySeverity,
      // Same occurrence-derived counts as the assessments list, so the dashboard
      // "Critical + High" column matches the full table.
      recentAssessments: await this.withFindingCounts(assessments.slice(0, 5)),
      ...(await this.getScoreTrend(userId)),
      ...(await this.getFindingsTrend(userId)),
    };
  }

  /**
   * Weekly findings trend for the "Findings by Severity" area chart: eight
   * consecutive 7-day buckets ending today, each split by severity, plus the
   * total of the eight weeks immediately before the window so the card can show
   * a period-over-period comparison badge.
   *
   * Counts real detections (`FindingOccurrence`) by `detectedAt`, scoped to the
   * user's active projects — the same scope as the current findings totals. No
   * mock data: a week with no detections stays at zero.
   */
  private async getFindingsTrend(userId: string) {
    const WEEKS = 8;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    // Exclusive upper bound at the end of today keeps bucket edges stable within
    // a day and includes everything detected so far today.
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const windowStart = new Date(windowEnd.getTime() - WEEKS * WEEK_MS);
    const previousStart = new Date(windowEnd.getTime() - 2 * WEEKS * WEEK_MS);

    const occurrences = await this.prisma.findingOccurrence.findMany({
      where: {
        issue: { project: { userId, isActive: true } },
        detectedAt: { gte: previousStart, lt: windowEnd },
      },
      select: { detectedAt: true, severitySnapshot: true },
    });

    const weeks = Array.from({ length: WEEKS }, (_, index) => ({
      weekStart: new Date(windowStart.getTime() + index * WEEK_MS).toISOString(),
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    }));

    let findingsTrendPreviousTotal = 0;
    for (const occurrence of occurrences) {
      const time = new Date(occurrence.detectedAt).getTime();
      if (time < windowStart.getTime()) {
        findingsTrendPreviousTotal += 1;
        continue;
      }
      const index = Math.floor((time - windowStart.getTime()) / WEEK_MS);
      if (index < 0 || index >= WEEKS) continue;
      const key = occurrence.severitySnapshot.toLowerCase();
      if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low' || key === 'info') {
        weeks[index][key] += 1;
      }
    }

    return { findingsTrend: weeks, findingsTrendPreviousTotal };
  }

  /**
   * Security-score evolution across the CURRENT calendar year — Jan through Dec,
   * always in that order, one bucket per month. The year is read from the clock,
   * so the chart rolls over to the new year automatically on Jan 1 (never
   * hardcoded).
   *
   * Each bucket carries the average `securityScore` of the assessments COMPLETED
   * that month and how many completed. Real data only: a month with no scored
   * assessment returns `averageScore: null` — never 0 — because a real 0 is the
   * worst possible posture and must stay distinct from "no information". Future
   * months of the current year are naturally empty (null) as no scan has run yet.
   *
   * `scoreTrendAverage` is the mean score across every scored assessment
   * completed this year — the same period the chart represents.
   */
  private async getScoreTrend(userId: string) {
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    const months = Array.from({ length: 12 }, (_, monthIndex) => ({
      key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      scoreSum: 0,
      scoreCount: 0,
      completedCount: 0,
    }));

    const completed = await this.prisma.assessment.findMany({
      where: {
        project: { userId },
        status: 'COMPLETED',
        completedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { completedAt: true, summary: { select: { securityScore: true } } },
    });

    let yearScoreSum = 0;
    let yearScoreCount = 0;
    for (const assessment of completed) {
      if (!assessment.completedAt) continue;
      const bucket = months[new Date(assessment.completedAt).getMonth()];
      if (!bucket) continue;
      bucket.completedCount += 1;
      const score = assessment.summary?.securityScore;
      if (typeof score === 'number') {
        bucket.scoreSum += score;
        bucket.scoreCount += 1;
        yearScoreSum += score;
        yearScoreCount += 1;
      }
    }

    return {
      scoreTrend: months.map((month) => ({
        month: month.key,
        averageScore: month.scoreCount > 0 ? Math.round(month.scoreSum / month.scoreCount) : null,
        completedCount: month.completedCount,
      })),
      scoreTrendAverage: yearScoreCount > 0 ? Math.round(yearScoreSum / yearScoreCount) : null,
    };
  }
}
