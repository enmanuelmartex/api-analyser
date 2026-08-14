import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { lastCompleteWeek, percentChange, previousWeek, type WeekRange } from './week-range';

/**
 * The system's own zone, used for a user who has not chosen one.
 *
 * Resolved from the runtime rather than hardcoded to UTC: a self-hosted install
 * running in an office is almost always in that office's zone, and reporting
 * their week in UTC would put Sunday evening's scans in the following week.
 * Falls back to UTC only if the platform cannot say.
 */
function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** One figure with its comparison against the week before. */
export interface WeeklyMetric {
  count: number;
  /** Null when the previous week had nothing to compare against. */
  changePercent: number | null;
}

export interface WeeklySummary {
  week: WeekRange;
  assessments: WeeklyMetric;
  findings: WeeklyMetric;
  critical: WeeklyMetric;
  activeProjects: number;
  /** True when the user did nothing at all in either week. */
  isEmpty: boolean;
}

/**
 * Computes the numbers the weekly digest reports.
 *
 * Split out of the processor and given no knowledge of email, so that the
 * arithmetic — which is the part that can be quietly wrong for months — can be
 * tested against a database without a queue, a template or a mail provider in
 * the loop.
 *
 * ── What "this user's activity" means ───────────────────────────────────────
 *
 * Everything is scoped through `project.userId`. An assessment belongs to a
 * project and a project belongs to a user, so a user's week is the assessments
 * of their own projects and nothing else. There is no installation-wide
 * variant: a digest that mixed in another user's projects would leak both the
 * existence of those projects and their security posture.
 */
@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * The digest for one user, over the last complete week in their own zone.
   *
   * Returns null when the user has no projects at all — there is no week to
   * report on, and a digest of four zeroes is worse than no digest.
   */
  async compute(userId: string, now: Date = new Date()): Promise<WeeklySummary | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });

    const timeZone = user?.timeZone || systemTimeZone();
    const week = lastCompleteWeek(now, timeZone);
    const prior = previousWeek(week, timeZone);

    const projectIds = await this.prisma.project
      .findMany({ where: { userId }, select: { id: true } })
      .then((rows) => rows.map((row) => row.id));

    if (projectIds.length === 0) return null;

    // Both weeks are gathered in one pass each rather than six round trips.
    const [current, previous] = await Promise.all([
      this.totalsFor(projectIds, week),
      this.totalsFor(projectIds, prior),
    ]);

    /*
     * "Active" is a state, not an event, so it has no week-over-week figure and
     * is counted as of now: projects that ran at least one assessment during
     * the reported week. A project created and never scanned is not activity,
     * and counting it would make the tile disagree with the assessments tile
     * for a user who set up projects and never ran anything.
     */
    const activeProjects = await this.prisma.project.count({
      where: {
        userId,
        assessments: {
          some: {
            status: 'COMPLETED',
            completedAt: { gte: week.start, lt: week.endExclusive },
          },
        },
      },
    });

    const summary: WeeklySummary = {
      week,
      assessments: {
        count: current.assessments,
        changePercent: percentChange(current.assessments, previous.assessments),
      },
      findings: {
        count: current.findings,
        changePercent: percentChange(current.findings, previous.findings),
      },
      critical: {
        count: current.critical,
        changePercent: percentChange(current.critical, previous.critical),
      },
      activeProjects,
      isEmpty:
        current.assessments === 0 && previous.assessments === 0 && activeProjects === 0,
    };

    this.logger.debug(
      `[Weekly] ${userId}: ${week.fromDate}..${week.toDate} (${timeZone}) — ` +
        `${summary.assessments.count} assessments, ${summary.findings.count} findings`,
    );

    return summary;
  }

  /**
   * Assessment, finding and critical counts for one window.
   *
   * Read from `AssessmentSummary` rather than by counting `SecurityIssue` rows,
   * for two reasons. It is the frozen snapshot taken at scan time, so a finding
   * triaged or deleted afterwards does not retroactively change what last week
   * looked like. And it is one aggregate over one indexed table instead of a
   * join across every finding of every scan.
   *
   * Only COMPLETED assessments count. A failed or cancelled run produced no
   * meaningful numbers — its summary row may hold a null score and zero counts —
   * and including it would report work that did not happen.
   */
  private async totalsFor(projectIds: string[], range: WeekRange) {
    const [assessments, aggregate] = await Promise.all([
      this.prisma.assessment.count({
        where: {
          projectId: { in: projectIds },
          status: 'COMPLETED',
          completedAt: { gte: range.start, lt: range.endExclusive },
        },
      }),
      this.prisma.assessmentSummary.aggregate({
        where: {
          assessment: {
            projectId: { in: projectIds },
            status: 'COMPLETED',
            completedAt: { gte: range.start, lt: range.endExclusive },
          },
        },
        _sum: { totalFindings: true, criticalCount: true },
      }),
    ]);

    return {
      assessments,
      // `_sum` is null over an empty set, which is the normal state of a quiet
      // week and must read as 0 rather than propagating into the arithmetic.
      findings: aggregate._sum.totalFindings ?? 0,
      critical: aggregate._sum.criticalCount ?? 0,
    };
  }

  /**
   * An absolute link into this installation, or nothing.
   *
   * Same rule as the rest of the email pipeline: nothing when `APP_URL` /
   * `FRONTEND_URL` is unset or is not absolute, because the relay rejects a
   * relative link with a 400 and a broken button helps nobody.
   */
  dashboardUrl(): string | undefined {
    const base = this.config.get<string>('email.appUrl') ?? '';
    if (!base) return undefined;

    try {
      const url = new URL('/dashboard', base.endsWith('/') ? base : `${base}/`);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
  }
}
