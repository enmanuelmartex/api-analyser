import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, ScheduledScan, ScheduleFrequency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import type { ScheduleChangedEvent } from '../events/domain-events';
import { CreateScheduledScanDto } from './dto/create-scheduled-scan.dto';
import { UpdateScheduledScanDto } from './dto/update-scheduled-scan.dto';
import { QueryScheduledScansDto } from './dto/query-scheduled-scans.dto';
import { ScheduleDispatcherService } from './schedule-dispatcher.service';
import {
  computeNextRun,
  computeNextRuns,
  describeRecurrence,
  MIN_INTERVAL_MINUTES,
  minimumGapMinutes,
  type RecurrenceRule,
} from './recurrence/recurrence';
import { CronParseError, parseCron } from './recurrence/cron';
import { formatUtcOffset, zonedPartsOf } from './recurrence/zoned-time';
import { displayStatusOf, toRule } from './schedule-rule';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXECUTIONS_PAGE_SIZE = 20;

/** How many upcoming runs the dashboard card and the create-form preview show. */
const PREVIEW_RUNS = 5;

@Injectable()
export class ScheduledScansService {
  private readonly logger = new Logger(ScheduledScansService.name);

  constructor(
    private prisma: PrismaService,
    private pluginRegistry: PluginRegistryService,
    private dispatcher: ScheduleDispatcherService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * One page of every schedule in the installation — shared across users, like
   * every other business resource. See `ProjectsService.findAll`.
   */
  async findAll(query: QueryScheduledScansDto = {}) {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));

    const where: Prisma.ScheduledScanWhereInput = {
      // isActive: true — same reasoning as AssessmentsService.findAll: a
      // project soft-deleted before hard delete became the behavior would
      // otherwise keep its schedules listed here.
      project: { isActive: true },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.frequency?.length ? { frequency: { in: query.frequency } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { project: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.scheduledScan.count({ where }),
      this.prisma.scheduledScan.findMany({
        where,
        include: LIST_INCLUDE,
        // Active schedules first, then by imminence. A paused schedule has no
        // `nextRunAt`, and NULLS LAST keeps it from sitting above the run that
        // is about to happen.
        orderBy: [{ nextRunAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(id: string) {
    const schedule = await this.prisma.scheduledScan.findFirst({
      where: { id },
      include: LIST_INCLUDE,
    });
    if (!schedule) throw new NotFoundException('Scheduled scan not found');

    return {
      ...this.toResponse(schedule),
      // A short preview of what is coming, so the detail page can answer "and
      // then?" without the reader recomputing the rule in their head.
      upcomingRuns:
        schedule.status === 'ACTIVE'
          ? computeNextRuns(toRule(schedule), PREVIEW_RUNS).map((run) => run.toISOString())
          : [],
    };
  }

  /** Execution history for one schedule, newest first. */
  async listExecutions(id: string, page = 1, pageSize = EXECUTIONS_PAGE_SIZE) {
    await this.assertExists(id);

    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
    const where = { scheduleId: id };

    const [total, rows] = await Promise.all([
      this.prisma.scheduleExecution.count({ where }),
      this.prisma.scheduleExecution.findMany({
        where,
        orderBy: { scheduledFor: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        include: {
          // Enough of the assessment to render the row and link to it. The
          // execution links to a real assessment, so the trail from a schedule
          // to its findings and reports is one click at every step.
          assessment: {
            select: {
              id: true,
              status: true,
              progress: true,
              startedAt: true,
              completedAt: true,
              duration: true,
              summary: {
                select: {
                  totalFindings: true,
                  criticalCount: true,
                  highCount: true,
                  securityScore: true,
                  scoreStatus: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: rows,
      page: safePage,
      pageSize: safeSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    };
  }

  /**
   * The next few runs across every active schedule in the installation.
   *
   * Feeds the dashboard's "Upcoming scheduled scans" strip. Deliberately a
   * separate, tiny query rather than a filter over `findAll`: the dashboard
   * wants three rows and must not pay for a page of full schedule payloads.
   */
  async upcoming(limit = 5) {
    const rows = await this.prisma.scheduledScan.findMany({
      where: { status: 'ACTIVE', nextRunAt: { not: null } },
      orderBy: { nextRunAt: 'asc' },
      take: Math.min(20, Math.max(1, Math.floor(limit))),
      select: {
        id: true,
        name: true,
        timezone: true,
        nextRunAt: true,
        frequency: true,
        project: { select: { id: true, name: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      frequency: row.frequency,
      projectId: row.project.id,
      projectName: row.project.name,
      nextRunAt: row.nextRunAt,
      timezone: row.timezone,
      timezoneOffset: formatUtcOffset(row.timezone, row.nextRunAt ?? new Date()),
    }));
  }

  /**
   * Validates a proposed rule and describes what it would do — without saving.
   *
   * The create form needs "Runs every Monday and Wednesday at 2:00 AM" and the
   * first few instants as the operator types. Computing that here rather than
   * in the browser means the preview is produced by the same code that will
   * later fire the schedule, so a preview that says 02:00 cannot be followed by
   * a run at 22:00.
   */
  preview(dto: CreateScheduledScanDto) {
    const rule = this.buildRule(dto);
    const runs = computeNextRuns(rule, PREVIEW_RUNS);

    return {
      description: describeRecurrence(rule),
      timezone: rule.timezone,
      timezoneOffset: formatUtcOffset(rule.timezone),
      nextRuns: runs.map((run) => run.toISOString()),
      nextRunAt: runs[0]?.toISOString() ?? null,
    };
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateScheduledScanDto) {
    const project = await this.assertScannableProject(dto.projectId);
    await this.assertValidScanConfig(dto, userId);

    const rule = this.buildRule(dto);
    const nextRunAt = computeNextRun(rule);
    if (!nextRunAt) {
      throw new BadRequestException('This configuration has no future run. Adjust the schedule.');
    }

    const schedule = await this.prisma.scheduledScan.create({
      data: {
        name: dto.name.trim(),
        projectId: dto.projectId,
        createdById: userId,
        ...ruleColumns(rule),
        ...configColumns(dto),
        skipIfRunning: dto.skipIfRunning ?? true,
        status: 'ACTIVE',
        nextRunAt,
      },
      include: LIST_INCLUDE,
    });

    this.emitChange(schedule, project.name, {
      change: 'created',
      action: 'CREATE',
      userId,
      message: `Scheduled scan "${schedule.name}" created for ${project.name} — ${describeRecurrence(rule)} (${schedule.timezone})`,
      metadata: {
        frequency: schedule.frequency,
        timezone: schedule.timezone,
        executionMode: schedule.executionMode,
        nextRunAt: nextRunAt.toISOString(),
      },
    });

    return this.toResponse(schedule);
  }

  /**
   * Edits a schedule and recomputes when it next runs.
   *
   * The recurrence is rebuilt from the MERGED state, never from the patch
   * alone: changing only the hour of a weekly schedule must keep its weekdays,
   * and validating the patch in isolation would reject it for having none.
   */
  async update(id: string, userId: string, dto: UpdateScheduledScanDto) {
    const existing = await this.assertExists(id);
    await this.assertValidScanConfig({ ...existing, ...dto } as CreateScheduledScanDto, userId);

    const merged = this.mergeForRule(existing, dto);
    const rule = this.buildRule(merged);

    /*
     * A PAUSED schedule stays paused through an edit — editing is not
     * resuming, and silently reactivating it would start scanning a production
     * API that somebody deliberately stopped.
     *
     * A COMPLETED one does get a new `nextRunAt`, which is what makes "this
     * one-off already ran; give it a new date" work at all. Lumping the two
     * together as "not ACTIVE ⇒ no next run" left an edited one-off dead with
     * a future date sitting on it and nothing to fire it.
     */
    const nextRunAt = existing.status === 'PAUSED' ? null : computeNextRun(rule);
    if (existing.status === 'ACTIVE' && !nextRunAt) {
      throw new BadRequestException('This configuration has no future run. Adjust the schedule.');
    }

    const schedule = await this.prisma.scheduledScan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...ruleColumns(rule),
        ...configColumns(merged),
        ...(dto.skipIfRunning !== undefined ? { skipIfRunning: dto.skipIfRunning } : {}),
        nextRunAt,
        // An edited ONCE schedule with a future instant becomes runnable again.
        status: existing.status === 'COMPLETED' && nextRunAt ? 'ACTIVE' : existing.status,
      },
      include: LIST_INCLUDE,
    });

    this.emitChange(schedule, schedule.project.name, {
      change: 'updated',
      action: 'UPDATE',
      userId,
      message: `Scheduled scan "${schedule.name}" updated — ${describeRecurrence(rule)} (${schedule.timezone})`,
      metadata: {
        frequency: schedule.frequency,
        timezone: schedule.timezone,
        nextRunAt: nextRunAt?.toISOString() ?? null,
      },
    });

    return this.toResponse(schedule);
  }

  /**
   * Stops future runs.
   *
   * `nextRunAt` is cleared, which is what actually prevents dispatch: the
   * scheduler's query is `status = ACTIVE AND nextRunAt <= now`, so a paused
   * schedule is invisible to it on both counts.
   */
  async pause(id: string, userId: string) {
    const existing = await this.assertExists(id);
    if (existing.status === 'PAUSED') return this.toResponse(existing);

    const schedule = await this.prisma.scheduledScan.update({
      where: { id },
      data: { status: 'PAUSED', nextRunAt: null },
      include: LIST_INCLUDE,
    });

    this.emitChange(schedule, schedule.project.name, {
      change: 'paused',
      action: 'UPDATE',
      userId,
      message: `Scheduled scan "${schedule.name}" paused`,
    });

    return this.toResponse(schedule);
  }

  /**
   * Resumes from NOW, never from where it left off.
   *
   * A schedule paused for three weeks has twenty-one missed daily occurrences.
   * Firing them on resume would launch twenty-one scans at once against a
   * production API — so the next run is computed forward from the current
   * instant and the missed window is simply gone.
   */
  async resume(id: string, userId: string) {
    const existing = await this.assertExists(id);

    const rule = toRule(existing);
    const nextRunAt = computeNextRun(rule);
    if (!nextRunAt) {
      throw new BadRequestException(
        existing.frequency === 'ONCE'
          ? 'This one-off schedule is in the past. Edit its date and time before resuming.'
          : 'This configuration has no future run. Edit the schedule before resuming.',
      );
    }

    const schedule = await this.prisma.scheduledScan.update({
      where: { id },
      data: { status: 'ACTIVE', nextRunAt },
      include: LIST_INCLUDE,
    });

    this.emitChange(schedule, schedule.project.name, {
      change: 'resumed',
      action: 'UPDATE',
      userId,
      message: `Scheduled scan "${schedule.name}" resumed — next run ${nextRunAt.toISOString()}`,
      metadata: { nextRunAt: nextRunAt.toISOString() },
    });

    return this.toResponse(schedule);
  }

  /**
   * Deletes the schedule. The scans it produced survive.
   *
   * `Assessment.scheduleId` is ON DELETE SET NULL, so the assessments, their
   * findings and their reports are untouched — only the automation disappears.
   * The execution rows go with the schedule, because an execution has no
   * meaning without the rule that produced it.
   */
  async remove(id: string, userId: string) {
    const existing = await this.assertExists(id);

    const [assessmentCount, executionCount] = await Promise.all([
      this.prisma.assessment.count({ where: { scheduleId: id } }),
      this.prisma.scheduleExecution.count({ where: { scheduleId: id } }),
    ]);

    await this.prisma.scheduledScan.delete({ where: { id } });

    this.emitChange(existing, existing.project.name, {
      change: 'deleted',
      action: 'DELETE',
      userId,
      message: `Scheduled scan "${existing.name}" deleted — ${assessmentCount} scan${assessmentCount === 1 ? '' : 's'} it produced were kept`,
      metadata: { assessmentsKept: assessmentCount, executionsRemoved: executionCount },
    });

    return { deleted: true, assessmentsKept: assessmentCount };
  }

  /**
   * Runs the schedule's configuration immediately.
   *
   * Explicitly does NOT touch `nextRunAt`: "Run now" answers "scan it now", not
   * "reschedule everything around now". The automatic series continues exactly
   * as it would have.
   */
  async runNow(id: string, userId: string) {
    const schedule = await this.assertExists(id);

    const result = await this.dispatcher.runNow(schedule.id, userId);

    this.emitChange(schedule, schedule.project.name, {
      change: 'run_now',
      action: 'CREATE',
      userId,
      message: `Scheduled scan "${schedule.name}" run manually against ${schedule.project.name}`,
      metadata: {
        assessmentId: result.assessmentId ?? null,
        executionId: result.executionId ?? null,
        skipped: result.skipped,
      },
    });

    if (result.skipped) {
      throw new BadRequestException(
        result.reason ?? 'A scan from this schedule is already running.',
      );
    }
    if (!result.assessmentId) {
      throw new BadRequestException(result.reason ?? 'The scan could not be started.');
    }

    return {
      assessmentId: result.assessmentId,
      executionId: result.executionId,
      // Unchanged by design, and returned so the UI can show it did not move.
      nextRunAt: schedule.nextRunAt,
    };
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  /**
   * Turns a request into a recurrence rule, rejecting anything incoherent.
   *
   * The backend is the source of truth for these rules. The form applies the
   * same constraints for immediate feedback, but every one of them is enforced
   * here, because the API is reachable without the form.
   */
  private buildRule(input: RuleInput): RecurrenceRule {
    const timezone = input.timezone;
    const frequency = input.frequency as ScheduleFrequency;
    const hour = input.hour ?? 0;
    const minute = input.minute ?? 0;
    const startAt = input.startAt ? new Date(input.startAt) : null;

    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('startAt is not a valid date');
    }

    const base: RecurrenceRule = { frequency, timezone, hour, minute, startAt };

    switch (frequency) {
      case 'ONCE': {
        if (!startAt) {
          throw new BadRequestException('Choose the date and time for this one-off scan');
        }
        if (startAt.getTime() <= Date.now()) {
          throw new BadRequestException('The date and time for a one-off scan must be in the future');
        }
        // The time of day is echoed back from the chosen instant so the detail
        // page can render it in the schedule's zone without re-deriving it.
        const parts = zonedPartsOf(startAt, timezone);
        return { ...base, hour: parts.hour, minute: parts.minute, startAt };
      }

      case 'HOURLY': {
        const intervalHours = input.intervalHours ?? 1;
        if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 23) {
          throw new BadRequestException('The interval must be a whole number of hours between 1 and 23');
        }
        /*
         * The anchor is what makes an interval reproducible.
         *
         * Without one, "every 6 hours" would have to be measured from the last
         * run — which drifts a little each time and jumps after every skipped
         * or failed run. Anchoring to the chosen time of day means the series
         * is a pure function of stored data.
         */
        const anchor =
          startAt ?? computeNextRun({ frequency: 'DAILY', timezone, hour, minute }) ?? new Date();
        return { ...base, intervalHours, startAt: anchor };
      }

      case 'DAILY':
        return base;

      case 'WEEKLY': {
        const weekdays = [...new Set(input.weekdays ?? [])].sort((a, b) => a - b);
        if (weekdays.length === 0) {
          throw new BadRequestException('Select at least one day of the week');
        }
        if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
          throw new BadRequestException('Days of the week must be between 0 (Sunday) and 6 (Saturday)');
        }
        return { ...base, weekdays };
      }

      case 'MONTHLY': {
        const monthDay = input.monthDay ?? 1;
        if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
          throw new BadRequestException('The day of the month must be between 1 and 31');
        }
        return { ...base, monthDay };
      }

      case 'CUSTOM': {
        const expression = input.cronExpression?.trim();
        if (!expression) {
          throw new BadRequestException('Enter a cron expression for a custom schedule');
        }
        try {
          parseCron(expression);
        } catch (error) {
          throw new BadRequestException(
            error instanceof CronParseError ? error.message : 'The cron expression is not valid',
          );
        }

        const rule: RecurrenceRule = { ...base, cronExpression: expression };
        this.assertSafeInterval(rule);
        return rule;
      }

      default:
        throw new BadRequestException('Unsupported frequency');
    }
  }

  /**
   * Rejects a rule that would scan more often than the product allows.
   *
   * This is a security product pointing traffic at somebody's API: `* * * * *`
   * is a minute-by-minute assault on a production system, and accepting it
   * because it parses would make the cron field a denial-of-service primitive
   * with a text box in front of it. The floor is measured from the rule's own
   * output, so no expression shape can slip past it.
   */
  private assertSafeInterval(rule: RecurrenceRule) {
    const gap = minimumGapMinutes(rule);
    if (gap !== null && gap < MIN_INTERVAL_MINUTES) {
      throw new BadRequestException(
        `This expression would run every ${gap} minute${gap === 1 ? '' : 's'}. ` +
          `Scheduled scans must be at least ${MIN_INTERVAL_MINUTES} minutes apart.`,
      );
    }
  }

  /** The project must exist and be scannable at all. */
  private async assertScannableProject(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        status: true,
        apiSpec: { select: { id: true, _count: { select: { endpoints: true } } } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== 'READY') {
      throw new BadRequestException('Complete project setup before scheduling a scan');
    }
    if (!project.apiSpec) {
      throw new BadRequestException('Import an OpenAPI specification before scheduling a scan');
    }
    if (project.apiSpec._count.endpoints === 0) {
      throw new BadRequestException('No endpoints found in the API specification');
    }

    return project;
  }

  /**
   * The scan configuration must be one the pipeline could actually run.
   *
   * Checked at write time so a broken selection is reported while the operator
   * is looking at the form, rather than at 02:00 as a failed execution. It is
   * NOT a guarantee for later: a check can be disabled between now and the run,
   * and the dispatcher records that as a failed execution without pausing the
   * schedule.
   */
  private async assertValidScanConfig(dto: Partial<CreateScheduledScanDto>, userId: string) {
    const mode = dto.executionMode ?? 'all';

    if (mode === 'profile') {
      if (!dto.scanProfileId) throw new BadRequestException('Select a scan profile');
      const profile = await this.prisma.scanProfile.findFirst({
        where: { id: dto.scanProfileId, OR: [{ isSystem: true }, { userId }] },
        select: { id: true, enabledPlugins: true },
      });
      if (!profile) throw new BadRequestException('The selected scan profile is not available');
      if (!profile.enabledPlugins.length) {
        throw new BadRequestException('The selected scan profile has no security checks');
      }
      return;
    }

    if (mode === 'manual') {
      const ids = [...new Set(dto.manualPlugins ?? [])];
      if (!ids.length) throw new BadRequestException('Select at least one security check');
      const unknown = ids.filter((id) => !this.pluginRegistry.has(id));
      if (unknown.length) {
        throw new BadRequestException('One or more selected security checks are not available');
      }
    }
  }

  /** Loads a schedule by id, or fails the way the API always does. */
  private async assertExists(id: string) {
    const schedule = await this.prisma.scheduledScan.findFirst({
      where: { id },
      include: LIST_INCLUDE,
    });
    if (!schedule) throw new NotFoundException('Scheduled scan not found');
    return schedule;
  }

  /** Existing row + patch, in the shape `buildRule` expects. */
  private mergeForRule(existing: ScheduledScan, dto: UpdateScheduledScanDto): RuleInput {
    const frequency = dto.frequency ?? existing.frequency;
    const changedFrequency = frequency !== existing.frequency;

    return {
      frequency,
      timezone: dto.timezone ?? existing.timezone,
      hour: dto.hour ?? existing.hour ?? 0,
      minute: dto.minute ?? existing.minute ?? 0,
      intervalHours: dto.intervalHours ?? existing.intervalHours ?? undefined,
      weekdays: dto.weekdays ?? existing.weekdays,
      monthDay: dto.monthDay ?? existing.monthDay ?? undefined,
      cronExpression: dto.cronExpression ?? existing.cronExpression ?? undefined,
      /*
       * `startAt` is dropped when the frequency changes, and when an HOURLY
       * schedule is edited without one being supplied.
       *
       * It means different things per frequency — the instant for ONCE, the
       * interval anchor for HOURLY, a lower bound for the rest — so carrying a
       * stale value across a change of frequency would apply a bound nobody
       * asked for. Re-anchoring on an HOURLY edit is what makes "every 4 hours
       * from 02:00" line up with 02:00 again after the interval is changed.
       */
      startAt:
        dto.startAt ??
        (changedFrequency || frequency === 'HOURLY'
          ? undefined
          : existing.startAt?.toISOString()),
      executionMode: (dto.executionMode ?? existing.executionMode) as 'all' | 'profile' | 'manual',
      scanProfileId: dto.scanProfileId ?? existing.scanProfileId ?? undefined,
      manualPlugins: dto.manualPlugins ?? existing.manualPlugins,
      enableAiAnalysis: dto.enableAiAnalysis ?? existing.enableAiAnalysis,
      maxRequestsPerEndpoint: dto.maxRequestsPerEndpoint ?? existing.maxRequestsPerEndpoint,
      requestDelayMs: dto.requestDelayMs ?? existing.requestDelayMs,
      timeoutMs: dto.timeoutMs ?? existing.timeoutMs,
    };
  }

  private emitChange(
    schedule: { id: string; name: string; projectId: string },
    projectName: string,
    input: Pick<ScheduleChangedEvent, 'change' | 'action' | 'message' | 'metadata' | 'userId'>,
  ) {
    this.eventEmitter.emit('schedule.changed', {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      projectId: schedule.projectId,
      projectName,
      ...input,
    } satisfies ScheduleChangedEvent);
  }

  // ── Presentation ───────────────────────────────────────────────────────────

  /**
   * The API shape of a schedule.
   *
   * Everything the UI needs to render a row without knowing the recurrence
   * rules: the human description, the zone's current offset, and the derived
   * activity status. Producing them here is what keeps the list, the detail
   * page and the dashboard from each phrasing the same rule differently.
   */
  private toResponse(schedule: ScheduleWithRelations) {
    const rule = toRule(schedule);
    const lastExecution = schedule.executions?.[0] ?? null;

    return {
      id: schedule.id,
      name: schedule.name,
      projectId: schedule.projectId,
      project: schedule.project,
      createdById: schedule.createdById,
      createdBy: schedule.createdBy ?? null,

      frequency: schedule.frequency,
      timezone: schedule.timezone,
      timezoneOffset: formatUtcOffset(schedule.timezone, schedule.nextRunAt ?? new Date()),
      hour: schedule.hour,
      minute: schedule.minute,
      intervalHours: schedule.intervalHours,
      weekdays: schedule.weekdays,
      monthDay: schedule.monthDay,
      cronExpression: schedule.cronExpression,
      startAt: schedule.startAt,
      /** "Every Monday and Wednesday at 2:00 AM" — server-rendered, one source. */
      description: describeRecurrence(rule),

      executionMode: schedule.executionMode,
      scanProfileId: schedule.scanProfileId,
      scanProfile: schedule.scanProfile ?? null,
      manualPlugins: schedule.manualPlugins,
      enableAiAnalysis: schedule.enableAiAnalysis,
      maxRequestsPerEndpoint: schedule.maxRequestsPerEndpoint,
      requestDelayMs: schedule.requestDelayMs,
      timeoutMs: schedule.timeoutMs,
      skipIfRunning: schedule.skipIfRunning,

      status: schedule.status,
      displayStatus: displayStatusOf(schedule, lastExecution),
      nextRunAt: schedule.nextRunAt,
      lastRunAt: schedule.lastRunAt,
      lastExecution,
      totalRuns: schedule.totalRuns,
      consecutiveFailures: schedule.consecutiveFailures,

      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    };
  }
}

// ── Shared shapes and helpers ────────────────────────────────────────────────

/** What `buildRule` needs, whether it came from a create, a patch or a row. */
interface RuleInput {
  frequency: ScheduleFrequency;
  timezone: string;
  hour?: number | null;
  minute?: number | null;
  intervalHours?: number | null;
  weekdays?: number[] | null;
  monthDay?: number | null;
  cronExpression?: string | null;
  startAt?: string | null;
  executionMode?: 'all' | 'profile' | 'manual';
  scanProfileId?: string;
  manualPlugins?: string[];
  enableAiAnalysis?: boolean;
  maxRequestsPerEndpoint?: number;
  requestDelayMs?: number;
  timeoutMs?: number;
}

/**
 * The relations every schedule response carries.
 *
 * `executions: take 1` is the whole basis of the derived RUNNING / FAILED
 * status, and one row per schedule keeps the list query flat rather than
 * issuing a second query per row.
 */
const LIST_INCLUDE = {
  project: { select: { id: true, name: true, baseUrl: true, environment: true } },
  scanProfile: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  executions: { orderBy: { scheduledFor: 'desc' as const }, take: 1 },
} satisfies Prisma.ScheduledScanInclude;

type ScheduleWithRelations = Prisma.ScheduledScanGetPayload<{ include: typeof LIST_INCLUDE }>;

/** The recurrence columns of a rule, ready for a create or an update. */
function ruleColumns(rule: RecurrenceRule) {
  return {
    frequency: rule.frequency as ScheduleFrequency,
    timezone: rule.timezone,
    hour: rule.hour ?? null,
    minute: rule.minute ?? null,
    intervalHours: rule.intervalHours ?? null,
    weekdays: rule.weekdays ?? [],
    monthDay: rule.monthDay ?? null,
    cronExpression: rule.cronExpression ?? null,
    startAt: rule.startAt ?? null,
  };
}

/** The scan-configuration columns, defaulted exactly as a manual run is. */
function configColumns(input: Partial<CreateScheduledScanDto>) {
  return {
    executionMode: input.executionMode ?? 'all',
    scanProfileId: input.executionMode === 'profile' ? (input.scanProfileId ?? null) : null,
    manualPlugins: input.executionMode === 'manual' ? [...new Set(input.manualPlugins ?? [])] : [],
    enableAiAnalysis: input.enableAiAnalysis ?? true,
    maxRequestsPerEndpoint: input.maxRequestsPerEndpoint ?? 10,
    requestDelayMs: input.requestDelayMs ?? 200,
    timeoutMs: input.timeoutMs ?? 10_000,
  };
}
