import { Injectable, Logger } from '@nestjs/common';
import { Prisma, IssueStatus, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeFingerprint,
  computeOccurrenceKey,
  type Fingerprint,
} from '../../common/identity/fingerprint.util';
import { redactHttpMessage, redactObject } from '../../common/utils/redact.util';
import type { ScanFinding } from '../scanner/types/scanner.types';

/** A detection ready to persist, with identity already resolved. */
interface ResolvedDetection {
  finding: ScanFinding;
  identity: Fingerprint;
  occurrenceKey: string;
}

/** What a scan actually exercised. Reconciliation must not exceed this. */
export interface ExecutedScope {
  /** Plugin ids that ran to completion. Only these may resolve an issue. */
  successfulPlugins: string[];
  /** Plugin ids that failed or timed out. Their issues are "not tested". */
  failedPlugins: string[];
  /** Plugin ids that were never selected or were disabled. */
  skippedPlugins: string[];
  /** Plugin version at execution time, for occurrence snapshots. */
  pluginVersions: Record<string, string>;
}

export interface PersistScanResultsInput {
  projectId: string;
  assessmentId: string;
  findings: ScanFinding[];
  scope: ExecutedScope;
  /** Timestamp used for every lastSeenAt/detectedAt, so retries are identical. */
  detectedAt: Date;
  assessmentConfigHash?: string;
  specVersion?: string;
}

export interface PersistScanResultsOutput {
  issuesCreated: number;
  issuesReopened: number;
  issuesRecurring: number;
  occurrencesCreated: number;
  /** Occurrences already present — a retry re-processing the same work. */
  occurrencesSkipped: number;
  /** Issues resolved by reconciliation because their detector ran and found nothing. */
  issuesResolved: number;
  /** Issues left untouched because their detector did not run. */
  issuesNotTested: number;
}

/** Prisma error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Owns the persistent vulnerability lifecycle.
 *
 * Every write is idempotent and backed by a database constraint, so re-running
 * a BullMQ job for the same assessment converges to the same state instead of
 * duplicating issues, occurrences, counters or history.
 */
@Injectable()
export class IssueLifecycleService {
  private readonly logger = new Logger(IssueLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists every detection of one scan, then reconciles issues that were in
   * scope but not detected.
   *
   * Deliberately NOT wrapped in a single transaction spanning the whole scan:
   * a scan can produce hundreds of detections, and holding one transaction open
   * that long blocks vacuum and risks lock contention. Each detection is its own
   * short transaction, and idempotency — not atomicity across the batch — is
   * what makes a partial run safe to retry.
   */
  async persistScanResults(input: PersistScanResultsInput): Promise<PersistScanResultsOutput> {
    const output: PersistScanResultsOutput = {
      issuesCreated: 0,
      issuesReopened: 0,
      issuesRecurring: 0,
      occurrencesCreated: 0,
      occurrencesSkipped: 0,
      issuesResolved: 0,
      issuesNotTested: 0,
    };

    const detections = this.resolveIdentities(input);

    for (const detection of detections) {
      const result = await this.persistDetection(detection, input);
      output.issuesCreated += result.issueCreated ? 1 : 0;
      output.issuesReopened += result.reopened ? 1 : 0;
      output.issuesRecurring += result.recurring ? 1 : 0;
      output.occurrencesCreated += result.occurrenceCreated ? 1 : 0;
      output.occurrencesSkipped += result.occurrenceCreated ? 0 : 1;
    }

    const reconciliation = await this.reconcile(input, detections);
    output.issuesResolved = reconciliation.resolved;
    output.issuesNotTested = reconciliation.notTested;

    return output;
  }

  /** Computes identity for every finding, dropping any that cannot be identified. */
  private resolveIdentities(input: PersistScanResultsInput): ResolvedDetection[] {
    const detections = new Map<string, ResolvedDetection>();

    for (const finding of input.findings) {
      if (!finding.pluginId || !finding.ruleId) {
        // Cannot be given a stable identity, so it can never be deduplicated or
        // triaged. Dropping it is better than persisting an orphan.
        this.logger.error(
          `Discarding a finding from "${finding.pluginId || 'unknown plugin'}": ` +
            `it has no ruleId, so it has no stable identity.`,
        );
        continue;
      }

      const identity = computeFingerprint({
        projectId: input.projectId,
        pluginId: finding.pluginId,
        ruleId: finding.ruleId,
        method: finding.method,
        route: finding.route,
        component: finding.component,
      });

      const detection = {
        finding,
        identity,
        occurrenceKey: computeOccurrenceKey(identity.fingerprintVersion, identity.fingerprint),
      };
      // Collapse duplicates before hitting the database uniqueness gate. The
      // gate remains necessary for retries and concurrent workers.
      if (!detections.has(detection.occurrenceKey)) {
        detections.set(detection.occurrenceKey, detection);
      }
    }

    return [...detections.values()];
  }

  /**
   * Persists one detection.
   *
   * Order matters: the occurrence is the idempotency gate. The issue row is
   * upserted first (it must exist for the occurrence to reference it), but
   * counters, lifecycle transitions and history are only applied when the
   * occurrence was genuinely new. A retry therefore re-runs the upsert
   * harmlessly and then stops, rather than incrementing occurrenceCount twice.
   */
  private async persistDetection(
    detection: ResolvedDetection,
    input: PersistScanResultsInput,
  ): Promise<{
    issueCreated: boolean;
    occurrenceCreated: boolean;
    reopened: boolean;
    recurring: boolean;
  }> {
    const { finding, identity } = detection;
    const severity = finding.severity as Severity;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.securityIssue.findUnique({
        where: {
          projectId_fingerprintVersion_fingerprint: {
            projectId: identity.projectId,
            fingerprintVersion: identity.fingerprintVersion,
            fingerprint: identity.fingerprint,
          },
        },
        select: { id: true, status: true, acceptedRiskUntil: true, occurrenceCount: true },
      });

      const issue = existing
        ? { id: existing.id, created: false }
        : {
            id: (
              await tx.securityIssue.create({
                data: {
                  projectId: identity.projectId,
                  fingerprint: identity.fingerprint,
                  fingerprintVersion: identity.fingerprintVersion,
                  pluginId: identity.pluginId,
                  ruleId: identity.ruleId,
                  method: identity.method,
                  normalizedRoute: identity.normalizedRoute,
                  component: identity.component,
                  title: finding.title,
                  description: finding.description,
                  severity,
                  owaspCategory: finding.owaspCategory,
                  cweId: finding.cweId,
                  cvssScore: finding.cvssScore,
                  cvssVector: finding.cvssVector,
                  status: IssueStatus.OPEN,
                  firstSeenAt: input.detectedAt,
                  lastSeenAt: input.detectedAt,
                  occurrenceCount: 0,
                },
                select: { id: true },
              })
            ).id,
            created: true,
          };

      // The idempotency gate. `(assessmentId, occurrenceKey)` is unique, so a
      // retry lands here and takes the early return below.
      const occurrenceCreated = await this.tryCreateOccurrence(
        tx,
        issue.id,
        detection,
        input,
        severity,
      );

      if (!occurrenceCreated) {
        return { issueCreated: issue.created, occurrenceCreated: false, reopened: false, recurring: false };
      }

      const transition = this.decideTransition(
        existing?.status ?? IssueStatus.OPEN,
        existing?.acceptedRiskUntil ?? null,
        input.detectedAt,
      );

      await tx.securityIssue.update({
        where: { id: issue.id },
        data: {
          lastSeenAt: input.detectedAt,
          occurrenceCount: { increment: 1 },
          // Current presentation follows the newest detection. Identity does
          // not, so rewording a rule never splits or merges an issue.
          title: finding.title,
          description: finding.description,
          severity,
          cvssScore: finding.cvssScore,
          cvssVector: finding.cvssVector,
          cweId: finding.cweId,
          ...(transition
            ? {
                status: transition.to,
                reopenedAt: input.detectedAt,
                resolvedAt: null,
                reopenCount: { increment: 1 },
              }
            : {}),
        },
      });

      if (transition) {
        await tx.issueStatusChange.create({
          data: {
            issueId: issue.id,
            fromStatus: transition.from,
            toStatus: transition.to,
            assessmentId: input.assessmentId,
            automatic: true,
            reason: transition.reason,
          },
        });
      }

      return {
        issueCreated: issue.created,
        occurrenceCreated: true,
        reopened: Boolean(transition),
        recurring: !issue.created && !transition,
      };
    });
  }

  /**
   * Creates the occurrence, returning false when one already exists for this
   * (assessment, issue) pair. The uniqueness check is left to the database
   * rather than a prior SELECT, so two concurrent workers cannot both pass it.
   */
  private async tryCreateOccurrence(
    tx: Prisma.TransactionClient,
    issueId: string,
    detection: ResolvedDetection,
    input: PersistScanResultsInput,
    severity: Severity,
  ): Promise<boolean> {
    const { finding, identity, occurrenceKey } = detection;

    try {
      await tx.findingOccurrence.create({
        data: {
          issueId,
          assessmentId: input.assessmentId,
          endpointId: finding.endpointId ?? null,
          occurrenceKey,

          methodSnapshot: identity.method,
          pathSnapshot: identity.normalizedRoute,
          pluginIdSnapshot: identity.pluginId,
          pluginVersionSnapshot: input.scope.pluginVersions[identity.pluginId] ?? 'unknown',
          ruleIdSnapshot: identity.ruleId,
          severitySnapshot: severity,
          cvssSnapshot: finding.cvssScore,
          owaspSnapshot: finding.owaspCategory,
          cweSnapshot: finding.cweId,
          titleSnapshot: finding.title,
          descriptionSnapshot: finding.description,
          impactSnapshot: finding.impact,
          remediationSnapshot: finding.remediation,

          // Evidence is redacted again here even though BasePlugin already
          // redacts it: this is the last boundary before it reaches storage,
          // and a future plugin could assemble evidence without the helper.
          evidence: redactObject(finding.evidence) ?? undefined,
          httpRequest: redactHttpMessage(finding.httpRequest),
          httpResponse: redactHttpMessage(finding.httpResponse),
          affectedUrl: finding.affectedUrl,
          location: identity.component,

          assessmentConfigHash: input.assessmentConfigHash,
          specVersionSnapshot: input.specVersion,
          detectedAt: input.detectedAt,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Decides whether a new detection changes the issue's triage state.
   *
   * Returns null when the state must be preserved, which is the case for most
   * states: re-detecting an issue is not new information about a human decision.
   */
  private decideTransition(
    current: IssueStatus,
    acceptedRiskUntil: Date | null,
    now: Date,
  ): { from: IssueStatus; to: IssueStatus; reason: string } | null {
    switch (current) {
      case IssueStatus.RESOLVED:
        // Believed fixed, detected again: the fix did not work or regressed.
        return {
          from: IssueStatus.RESOLVED,
          to: IssueStatus.OPEN,
          reason: 'Reopened automatically: the issue was detected again after being resolved.',
        };

      case IssueStatus.ACCEPTED_RISK:
        // An accepted risk stays accepted while the acceptance is valid.
        // Only an EXPIRED acceptance returns to OPEN, and only because the
        // acceptance itself lapsed — never because it was detected again.
        if (acceptedRiskUntil && acceptedRiskUntil.getTime() <= now.getTime()) {
          return {
            from: IssueStatus.ACCEPTED_RISK,
            to: IssueStatus.OPEN,
            reason: 'Reopened automatically: the risk acceptance expired and the issue is still present.',
          };
        }
        return null;

      case IssueStatus.FALSE_POSITIVE:
        // A human judged this not to be real. The detector disagreeing again is
        // exactly what it did last time, so it is not new information. The
        // occurrence is still recorded as evidence for manual review.
        return null;

      case IssueStatus.OPEN:
      case IssueStatus.ACKNOWLEDGED:
        // Already known and being worked. Recording a redundant OPEN -> OPEN
        // transition would bury the real history in noise.
        return null;

      default:
        return null;
    }
  }

  /**
   * Resolves issues that were genuinely re-tested and no longer detected.
   *
   * The critical rule: absence of a detection is NOT evidence of a fix. An issue
   * may only be resolved when the check that produces it actually ran to
   * completion in this scan. A plugin that was disabled, not selected, failed or
   * timed out leaves its issues untouched — they are "not tested", not "fixed".
   */
  private async reconcile(
    input: PersistScanResultsInput,
    detections: ResolvedDetection[],
  ): Promise<{ resolved: number; notTested: number }> {
    const successful = new Set(input.scope.successfulPlugins);
    const detectedFingerprints = new Set(detections.map((d) => d.identity.fingerprint));

    // Issues whose detector did not run to completion this scan. Counted first
    // and unconditionally: "not tested" is the answer whether or not any other
    // check succeeded, and it is the number that stops a partial scan from
    // looking like a clean one.
    const notTested = await this.prisma.securityIssue.count({
      where: {
        projectId: input.projectId,
        pluginId: { in: [...input.scope.failedPlugins, ...input.scope.skippedPlugins] },
        status: { in: [IssueStatus.OPEN, IssueStatus.ACKNOWLEDGED] },
      },
    });

    if (successful.size === 0) return { resolved: 0, notTested };

    // Only issues whose detector ran successfully are resolution candidates.
    // Everything else is out of scope for this scan by construction.
    const candidates = await this.prisma.securityIssue.findMany({
      where: {
        projectId: input.projectId,
        pluginId: { in: [...successful] },
        status: { in: [IssueStatus.OPEN, IssueStatus.ACKNOWLEDGED] },
      },
      select: { id: true, status: true, fingerprint: true },
    });

    const stale = candidates.filter((issue) => !detectedFingerprints.has(issue.fingerprint));
    if (stale.length === 0) return { resolved: 0, notTested };

    await this.prisma.$transaction(async (tx) => {
      await tx.securityIssue.updateMany({
        where: { id: { in: stale.map((issue) => issue.id) } },
        data: { status: IssueStatus.RESOLVED, resolvedAt: input.detectedAt },
      });

      await tx.issueStatusChange.createMany({
        data: stale.map((issue) => ({
          issueId: issue.id,
          fromStatus: issue.status,
          toStatus: IssueStatus.RESOLVED,
          assessmentId: input.assessmentId,
          automatic: true,
          reason:
            'Resolved automatically: the check that detects this issue ran successfully in this scan and no longer reported it.',
        })),
      });
    });

    return { resolved: stale.length, notTested };
  }
}
