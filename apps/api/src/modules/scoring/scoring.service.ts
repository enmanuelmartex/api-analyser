import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeScore,
  type ScorableIssue,
  type ScoreResult,
} from './score-engine';

/**
 * Owns every score that is written or read.
 *
 * The snapshot persisted here is the historical record: reports and comparisons
 * read it rather than recomputing, so changing an issue's severity, title or
 * triage state later cannot retroactively rewrite a score that was already
 * issued.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes and persists the score for one assessment.
   *
   * Idempotent: derived entirely from persisted occurrences and coverage
   * counters, so a BullMQ retry writes the same values rather than drifting.
   */
  async scoreAssessment(assessmentId: string): Promise<ScoreResult> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        status: true,
        summary: {
          select: {
            plannedChecks: true,
            successfulChecks: true,
            failedChecks: true,
            skippedChecks: true,
            executionErrors: true,
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const issues = await this.loadScorableIssues(assessmentId);

    const result = computeScore({
      assessmentStatus: assessment.status,
      issues,
      coverage: {
        plannedChecks: assessment.summary?.plannedChecks ?? 0,
        successfulChecks: assessment.summary?.successfulChecks ?? 0,
        failedChecks: assessment.summary?.failedChecks ?? 0,
        skippedChecks: assessment.summary?.skippedChecks ?? 0,
        executionErrors: assessment.summary?.executionErrors ?? 0,
      },
    });

    await this.prisma.assessmentSummary.update({
      where: { assessmentId },
      data: {
        securityScore: result.securityScore,
        scoreStatus: result.scoreStatus,
        // Version and timestamp are cleared with the score, so an unavailable
        // result cannot look like a stale-but-valid one.
        scoreVersion: result.securityScore === null ? null : result.scoreVersion,
        scoreComputedAt: result.securityScore === null ? null : new Date(),
        coveragePercent: result.coveragePercent,
        scoreExplanation: result as unknown as object,
      },
    });

    return result;
  }

  /**
   * Builds the scorable set from this scan's OCCURRENCES.
   *
   * Severity comes from `severitySnapshot` — the value observed at scan time —
   * never from the issue's current severity. That is what makes the score a
   * snapshot rather than a live recomputation.
   */
  private async loadScorableIssues(assessmentId: string): Promise<ScorableIssue[]> {
    const occurrences = await this.prisma.findingOccurrence.findMany({
      where: { assessmentId },
      select: {
        severitySnapshot: true,
        pluginIdSnapshot: true,
        ruleIdSnapshot: true,
        methodSnapshot: true,
        pathSnapshot: true,
        location: true,
        issue: { select: { fingerprint: true } },
      },
    });

    return occurrences.map((occurrence) => ({
      fingerprint: occurrence.issue.fingerprint,
      pluginId: occurrence.pluginIdSnapshot,
      ruleId: occurrence.ruleIdSnapshot,
      severity: occurrence.severitySnapshot as Severity,
      method: occurrence.methodSnapshot,
      normalizedRoute: occurrence.pathSnapshot,
      component: occurrence.location,
    }));
  }

  /**
   * Current security posture of a project.
   *
   * Policy, in order: the most recent FINAL assessment; otherwise the most
   * recent PROVISIONAL one, clearly labelled; otherwise unavailable. Never
   * derived from a stored copy on the project row — a denormalised score is a
   * score that can silently go stale.
   */
  async getProjectPosture(projectId: string) {
    const candidates = await this.prisma.assessment.findMany({
      where: { projectId, status: 'COMPLETED', summary: { isNot: null } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        summary: {
          select: {
            securityScore: true,
            scoreStatus: true,
            scoreVersion: true,
            coveragePercent: true,
            scoreComputedAt: true,
            plannedChecks: true,
            successfulChecks: true,
            failedChecks: true,
            skippedChecks: true,
          },
        },
      },
    });

    const chosen =
      candidates.find((a) => a.summary?.scoreStatus === 'FINAL') ??
      candidates.find((a) => a.summary?.scoreStatus === 'PROVISIONAL') ??
      null;

    if (!chosen?.summary) {
      return {
        currentSecurityScore: null,
        currentScoreStatus: 'UNAVAILABLE' as const,
        currentScoreVersion: null,
        currentCoveragePercent: null,
        scoredAt: null,
        assessmentId: null,
        reason:
          candidates.length === 0
            ? 'This project has not been scanned yet.'
            : 'No completed scan produced a score that could be computed.',
      };
    }

    return {
      currentSecurityScore: chosen.summary.securityScore,
      currentScoreStatus: chosen.summary.scoreStatus,
      currentScoreVersion: chosen.summary.scoreVersion,
      currentCoveragePercent: chosen.summary.coveragePercent,
      scoredAt: chosen.summary.scoreComputedAt ?? chosen.completedAt ?? chosen.createdAt,
      assessmentId: chosen.id,
      reason:
        chosen.summary.scoreStatus === 'PROVISIONAL'
          ? 'The most recent scan did not complete every planned check, so this score is provisional.'
          : null,
    };
  }

  /** The stored snapshot for one assessment. Never recomputed on read. */
  async getAssessmentScore(assessmentId: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, project: { userId } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        completedAt: true,
        summary: true,
      },
    });
    if (!assessment) throw new NotFoundException('Scan not found');

    const summary = assessment.summary;
    return {
      assessmentId: assessment.id,
      status: assessment.status,
      securityScore: summary?.securityScore ?? null,
      scoreStatus: summary?.scoreStatus ?? 'UNAVAILABLE',
      scoreVersion: summary?.scoreVersion ?? null,
      scoreComputedAt: summary?.scoreComputedAt ?? null,
      coveragePercent: summary?.coveragePercent ?? null,
      coverage: {
        plannedChecks: summary?.plannedChecks ?? 0,
        successfulChecks: summary?.successfulChecks ?? 0,
        failedChecks: summary?.failedChecks ?? 0,
        skippedChecks: summary?.skippedChecks ?? 0,
        executionErrors: summary?.executionErrors ?? 0,
      },
      explanation: summary?.scoreExplanation ?? null,
    };
  }
}
