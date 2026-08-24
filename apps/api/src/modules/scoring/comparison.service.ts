import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Compares two assessments of the same project.
 *
 * The governing rule: a higher score is not automatically an improvement. If
 * the second scan exercised less of the API, the difference reflects reduced
 * coverage, not reduced risk. Every comparison therefore carries an explicit
 * compatibility verdict and the coverage of both sides.
 */

export type Comparability = 'COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';

export type IssueChangeKind =
  | 'NEW'
  | 'PERSISTING'
  | 'RESOLVED'
  | 'REOPENED'
  | 'NOT_TESTED'
  | 'OUT_OF_SCOPE';

interface SideSnapshot {
  assessmentId: string;
  createdAt: Date;
  status: string;
  securityScore: number | null;
  scoreStatus: string;
  scoreVersion: string | null;
  coveragePercent: number | null;
  plannedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  skippedChecks: number;
  /** Plugins that ran to completion — the only ones that can prove absence. */
  successfulPlugins: string[];
  /** Plugins attempted but incomplete. */
  failedPlugins: string[];
  /** Every plugin in scope, successful or not. */
  scopePlugins: string[];
}

@Injectable()
export class ComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assessments that can be used as a baseline for the given one. */
  async getComparisonCandidates(assessmentId: string) {
    const target = await this.prisma.assessment.findFirst({
      where: { id: assessmentId },
      select: { id: true, projectId: true, createdAt: true },
    });
    if (!target) throw new NotFoundException('Scan not found');

    return this.prisma.assessment.findMany({
      where: {
        projectId: target.projectId,
        id: { not: target.id },
        status: 'COMPLETED',
        summary: { isNot: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        summary: {
          select: { securityScore: true, scoreStatus: true, scoreVersion: true, coveragePercent: true },
        },
      },
    });
  }

  /**
   * Compares `assessmentId` against `baselineId`, or against the most recent
   * earlier completed scan of the same project when no baseline is given.
   */
  async compare(assessmentId: string, baselineId?: string) {
    if (baselineId && baselineId === assessmentId) {
      throw new BadRequestException('A scan cannot be compared with itself.');
    }

    const current = await this.loadSide(assessmentId);

    const baseline = baselineId
      ? await this.loadSide(baselineId)
      : await this.findPreviousSide(assessmentId);

    if (!baseline) {
      return {
        comparability: 'NOT_COMPARABLE' as Comparability,
        warnings: ['There is no earlier completed scan of this project to compare against.'],
        current: this.publicSide(current),
        baseline: null,
        scoreDelta: null,
        coverageDelta: null,
        changes: { NEW: [], PERSISTING: [], RESOLVED: [], REOPENED: [], NOT_TESTED: [], OUT_OF_SCOPE: [] },
        scopeChanges: null,
      };
    }

    // Both sides must belong to the same project. Checked explicitly rather than
    // trusted, because a mismatched pair would silently produce nonsense.
    const [a, b] = await Promise.all([
      this.prisma.assessment.findUnique({ where: { id: current.assessmentId }, select: { projectId: true } }),
      this.prisma.assessment.findUnique({ where: { id: baseline.assessmentId }, select: { projectId: true } }),
    ]);
    if (!a || !b || a.projectId !== b.projectId) {
      throw new BadRequestException('Both scans must belong to the same project.');
    }

    const { comparability, warnings, scopeChanges } = this.assessComparability(baseline, current);
    const changes = await this.classifyChanges(baseline, current);

    const scoreDelta =
      baseline.securityScore !== null && current.securityScore !== null
        ? current.securityScore - baseline.securityScore
        : null;

    const coverageDelta =
      baseline.coveragePercent !== null && current.coveragePercent !== null
        ? Math.round((current.coveragePercent - baseline.coveragePercent) * 10) / 10
        : null;

    // The headline guard: never let a score rise on shrinking coverage read as
    // a genuine improvement.
    if (scoreDelta !== null && scoreDelta > 0 && coverageDelta !== null && coverageDelta < 0) {
      warnings.unshift(
        `The score rose by ${scoreDelta} points while coverage fell by ${Math.abs(coverageDelta)} points. ` +
          `The later scan examined less of the API, so this is not evidence that risk decreased.`,
      );
    }

    return {
      comparability,
      warnings,
      current: this.publicSide(current),
      baseline: this.publicSide(baseline),
      scoreDelta,
      coverageDelta,
      changes,
      scopeChanges,
    };
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  private async loadSide(assessmentId: string): Promise<SideSnapshot> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId },
      select: { id: true, createdAt: true, status: true, summary: true },
    });
    if (!assessment) throw new NotFoundException(`Scan ${assessmentId} not found`);
    return this.toSide(assessment);
  }

  private async findPreviousSide(assessmentId: string): Promise<SideSnapshot | null> {
    const target = await this.prisma.assessment.findFirst({
      where: { id: assessmentId },
      select: { projectId: true, createdAt: true },
    });
    if (!target) throw new NotFoundException('Scan not found');

    const previous = await this.prisma.assessment.findFirst({
      where: {
        projectId: target.projectId,
        createdAt: { lt: target.createdAt },
        status: 'COMPLETED',
        summary: { isNot: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, status: true, summary: true },
    });

    return previous ? this.toSide(previous) : null;
  }

  private toSide(assessment: any): SideSnapshot {
    const summary = assessment.summary;
    const plan = (summary?.pluginResults ?? {}) as {
      executed?: string[];
      failed?: string[];
      skipped?: string[];
    };
    const executed = plan.executed ?? [];
    const failed = plan.failed ?? [];

    return {
      assessmentId: assessment.id,
      createdAt: assessment.createdAt,
      status: assessment.status,
      securityScore: summary?.securityScore ?? null,
      scoreStatus: summary?.scoreStatus ?? 'UNAVAILABLE',
      scoreVersion: summary?.scoreVersion ?? null,
      coveragePercent: summary?.coveragePercent ?? null,
      plannedChecks: summary?.plannedChecks ?? 0,
      successfulChecks: summary?.successfulChecks ?? 0,
      failedChecks: summary?.failedChecks ?? 0,
      skippedChecks: summary?.skippedChecks ?? 0,
      successfulPlugins: executed.filter((id) => !failed.includes(id)),
      failedPlugins: failed,
      scopePlugins: executed,
    };
  }

  private publicSide(side: SideSnapshot) {
    return {
      assessmentId: side.assessmentId,
      createdAt: side.createdAt,
      securityScore: side.securityScore,
      scoreStatus: side.scoreStatus,
      scoreVersion: side.scoreVersion,
      coveragePercent: side.coveragePercent,
      plannedChecks: side.plannedChecks,
      successfulChecks: side.successfulChecks,
      failedChecks: side.failedChecks,
      skippedChecks: side.skippedChecks,
    };
  }

  // ── Compatibility ──────────────────────────────────────────────────────────

  private assessComparability(baseline: SideSnapshot, current: SideSnapshot) {
    const warnings: string[] = [];

    const baselineScope = new Set(baseline.scopePlugins);
    const currentScope = new Set(current.scopePlugins);
    const shared = [...baselineScope].filter((id) => currentScope.has(id));
    const added = [...currentScope].filter((id) => !baselineScope.has(id));
    const removed = [...baselineScope].filter((id) => !currentScope.has(id));

    const scopeChanges = {
      sharedChecks: shared.sort(),
      addedChecks: added.sort(),
      removedChecks: removed.sort(),
    };

    if (baseline.securityScore === null || current.securityScore === null) {
      warnings.push(
        'At least one of the scans has no computable score, so the two cannot be compared numerically.',
      );
      return { comparability: 'NOT_COMPARABLE' as Comparability, warnings, scopeChanges };
    }

    // Scores from different algorithm versions are not the same quantity.
    // Full comparability REQUIRES an identical scoreVersion — a missing version
    // on either side is also disqualifying, because an unknown algorithm cannot
    // be assumed to match.
    if (baseline.scoreVersion !== current.scoreVersion) {
      warnings.push(
        `The scans were scored with different algorithm versions ` +
          `(${baseline.scoreVersion ?? 'unknown'} vs ${current.scoreVersion ?? 'unknown'}), ` +
          `so their scores are not the same quantity and cannot be compared directly.`,
      );
      return { comparability: 'NOT_COMPARABLE' as Comparability, warnings, scopeChanges };
    }

    if (shared.length === 0) {
      warnings.push('The two scans have no checks in common, so there is nothing to compare.');
      return { comparability: 'NOT_COMPARABLE' as Comparability, warnings, scopeChanges };
    }

    let comparability: Comparability = 'COMPARABLE';

    if (added.length > 0 || removed.length > 0) {
      warnings.push(
        `Scope changed: ${baseline.scopePlugins.length} check(s) in the baseline, ` +
          `${current.scopePlugins.length} in the current scan. ` +
          `Results outside the ${shared.length} shared check(s) are marked as not tested.`,
      );
      comparability = 'PARTIALLY_COMPARABLE';
    }

    if (baseline.failedChecks > 0 || current.failedChecks > 0) {
      warnings.push(
        `Execution failures occurred (${baseline.failedChecks} in the baseline, ${current.failedChecks} in the current scan), so part of the comparison is unreliable.`,
      );
      comparability = 'PARTIALLY_COMPARABLE';
    }

    if (baseline.scoreStatus !== 'FINAL' || current.scoreStatus !== 'FINAL') {
      warnings.push(
        `At least one score is provisional (baseline: ${baseline.scoreStatus}, current: ${current.scoreStatus}).`,
      );
      comparability = 'PARTIALLY_COMPARABLE';
    }

    return { comparability, warnings, scopeChanges };
  }

  // ── Issue-level changes ────────────────────────────────────────────────────

  /**
   * Classifies every issue seen on either side.
   *
   * Absence is only ever `RESOLVED` when the responsible check ran to
   * completion in the current scan. Otherwise it is `NOT_TESTED` or
   * `OUT_OF_SCOPE` — never a resolution.
   */
  private async classifyChanges(baseline: SideSnapshot, current: SideSnapshot) {
    const [baselineOccurrences, currentOccurrences] = await Promise.all([
      this.loadOccurrenceIdentities(baseline.assessmentId),
      this.loadOccurrenceIdentities(current.assessmentId),
    ]);

    const currentByFingerprint = new Map(currentOccurrences.map((o) => [o.fingerprint, o]));
    const baselineByFingerprint = new Map(baselineOccurrences.map((o) => [o.fingerprint, o]));

    const currentSuccessful = new Set(current.successfulPlugins);
    const currentScope = new Set(current.scopePlugins);

    const changes: Record<IssueChangeKind, any[]> = {
      NEW: [],
      PERSISTING: [],
      RESOLVED: [],
      REOPENED: [],
      NOT_TESTED: [],
      OUT_OF_SCOPE: [],
    };

    for (const occurrence of currentOccurrences) {
      const previously = baselineByFingerprint.get(occurrence.fingerprint);
      const entry = {
        fingerprint: occurrence.fingerprint,
        issueId: occurrence.issueId,
        title: occurrence.title,
        severity: occurrence.severity,
        pluginId: occurrence.pluginId,
        ruleId: occurrence.ruleId,
        route: `${occurrence.method} ${occurrence.route}`,
        ...(previously && previously.severity !== occurrence.severity
          ? { severityChangedFrom: previously.severity }
          : {}),
      };

      if (!previously) {
        // Detected now and not before. Reopened when the persistent issue had
        // already been resolved at some point.
        (occurrence.reopenCount > 0 ? changes.REOPENED : changes.NEW).push(entry);
      } else {
        changes.PERSISTING.push(entry);
      }
    }

    for (const occurrence of baselineOccurrences) {
      if (currentByFingerprint.has(occurrence.fingerprint)) continue;

      const entry = {
        fingerprint: occurrence.fingerprint,
        issueId: occurrence.issueId,
        title: occurrence.title,
        severity: occurrence.severity,
        pluginId: occurrence.pluginId,
        ruleId: occurrence.ruleId,
        route: `${occurrence.method} ${occurrence.route}`,
      };

      if (!currentScope.has(occurrence.pluginId)) {
        changes.OUT_OF_SCOPE.push(entry);
      } else if (!currentSuccessful.has(occurrence.pluginId)) {
        changes.NOT_TESTED.push(entry);
      } else {
        changes.RESOLVED.push(entry);
      }
    }

    return changes;
  }

  private async loadOccurrenceIdentities(assessmentId: string) {
    const occurrences = await this.prisma.findingOccurrence.findMany({
      where: { assessmentId },
      select: {
        issueId: true,
        titleSnapshot: true,
        severitySnapshot: true,
        pluginIdSnapshot: true,
        ruleIdSnapshot: true,
        methodSnapshot: true,
        pathSnapshot: true,
        issue: { select: { fingerprint: true, reopenCount: true } },
      },
    });

    return occurrences.map((o) => ({
      issueId: o.issueId,
      fingerprint: o.issue.fingerprint,
      title: o.titleSnapshot,
      severity: o.severitySnapshot,
      pluginId: o.pluginIdSnapshot,
      ruleId: o.ruleIdSnapshot,
      method: o.methodSnapshot,
      route: o.pathSnapshot,
      reopenCount: o.issue.reopenCount,
    }));
  }
}
