import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IssueStatus, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Statuses that represent a vulnerability still present in the system.
 *
 * ACCEPTED_RISK is included on purpose: accepting a risk is a business decision,
 * not a remediation, so the technical exposure remains. RESOLVED and
 * FALSE_POSITIVE are excluded because neither describes live risk.
 */
export const OPEN_ISSUE_STATUSES: IssueStatus[] = [
  IssueStatus.OPEN,
  IssueStatus.ACKNOWLEDGED,
  IssueStatus.ACCEPTED_RISK,
];

export interface IssueFilters {
  projectId?: string;
  status?: string;
  severity?: string;
  owaspCategory?: string;
  pluginId?: string;
  ruleId?: string;
  assigneeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface UpdateIssueStatusInput {
  status: string;
  reason?: string;
  acceptedRiskUntil?: string;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Read and triage API for persistent vulnerabilities.
 *
 * Deliberately distinct from occurrences: this answers "what is wrong with this
 * project right now", while a scan's occurrences answer "what did that run
 * observe". The old findings API conflated the two, which is why the same
 * vulnerability appeared once per scan.
 */
@Injectable()
export class IssuesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated, deduplicated issues. One row per vulnerability, not per detection. */
  async findAll(userId: string, filters: IssueFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.SecurityIssueWhereInput = {
      project: { userId, isActive: true, ...(filters.projectId ? { id: filters.projectId } : {}) },
      ...(filters.status ? { status: this.parseStatus(filters.status) } : {}),
      ...(filters.severity ? { severity: this.parseSeverity(filters.severity) } : {}),
      ...(filters.owaspCategory ? { owaspCategory: filters.owaspCategory } : {}),
      ...(filters.pluginId ? { pluginId: filters.pluginId } : {}),
      ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: 'insensitive' } },
              { normalizedRoute: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.securityIssue.count({ where }),
      this.prisma.securityIssue.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, email: true, avatar: true } },
        },
        orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * AI guidance for one issue, or an explicit unavailable state.
   *
   * Never throws when guidance is missing — "no guidance yet" is a normal
   * outcome (AI disabled, provider unconfigured, scan predates the feature) and
   * must be distinguishable from "we tried and it failed". Ownership is checked
   * against the issue, so guidance cannot be read for another user's project.
   */
  async getGuidance(id: string, userId: string) {
    const issue = await this.prisma.securityIssue.findFirst({
      where: { id, project: { userId } },
      select: { id: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    const guidance = await (this.prisma as any).issueGuidance.findUnique({
      where: { issueId: id },
    });

    if (!guidance) {
      return {
        status: 'UNAVAILABLE',
        reason:
          'No AI guidance has been generated for this issue. It may predate AI analysis, or AI analysis may be disabled.',
        guidance: null,
      };
    }

    return {
      status: guidance.status,
      reason:
        guidance.status === 'FAILED'
          ? describeGuidanceFailure(guidance.errorCode)
          : null,
      guidance: guidance.payload ?? null,
      metadata: {
        provider: guidance.provider,
        model: guidance.model,
        promptVersion: guidance.promptVersion,
        knowledgeVersion: guidance.knowledgeVersion,
        schemaVersion: guidance.schemaVersion,
        playbookIds: guidance.playbookIds,
        confidence: guidance.confidence,
        generatedAt: guidance.generatedAt,
        tokensInput: guidance.tokensInput,
        tokensOutput: guidance.tokensOutput,
        estimatedCostUsd: guidance.costUsd,
      },
    };
  }

  /** One issue with its occurrence history and full triage timeline. */
  async findOne(id: string, userId: string) {
    const issue = await this.prisma.securityIssue.findFirst({
      where: { id, project: { userId } },
      include: {
        project: { select: { id: true, name: true, baseUrl: true } },
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        occurrences: {
          orderBy: { detectedAt: 'desc' },
          take: 50,
          include: {
            assessment: { select: { id: true, createdAt: true, status: true } },
          },
        },
        statusChanges: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  /**
   * Applies a manual triage decision and records it in the history.
   *
   * The history row is written in the same transaction as the status change, so
   * `SecurityIssue.status` can never disagree with the audit trail.
   */
  async updateStatus(id: string, userId: string, input: UpdateIssueStatusInput) {
    const issue = await this.prisma.securityIssue.findFirst({
      where: { id, project: { userId } },
      select: { id: true, status: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    const toStatus = this.parseStatus(input.status);

    // Decisions that discard or defer risk must say why, so the audit trail is
    // answerable months later.
    const REASON_REQUIRED: IssueStatus[] = [
      IssueStatus.FALSE_POSITIVE,
      IssueStatus.ACCEPTED_RISK,
      IssueStatus.RESOLVED,
    ];
    if (REASON_REQUIRED.includes(toStatus) && !input.reason?.trim()) {
      throw new BadRequestException(`A reason is required when marking an issue as ${toStatus}.`);
    }

    if (toStatus === issue.status) return this.findOne(id, userId);

    const acceptedRiskUntil = input.acceptedRiskUntil ? new Date(input.acceptedRiskUntil) : null;
    if (acceptedRiskUntil && Number.isNaN(acceptedRiskUntil.getTime())) {
      throw new BadRequestException('acceptedRiskUntil must be a valid date.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.securityIssue.update({
        where: { id },
        data: {
          status: toStatus,
          resolvedAt: toStatus === IssueStatus.RESOLVED ? new Date() : null,
          acceptedRiskUntil: toStatus === IssueStatus.ACCEPTED_RISK ? acceptedRiskUntil : null,
          ...(input.reason?.trim() ? { notes: input.reason.trim() } : {}),
        },
      });

      await tx.issueStatusChange.create({
        data: {
          issueId: id,
          fromStatus: issue.status,
          toStatus,
          actorId: userId,
          reason: input.reason?.trim() || null,
          automatic: false,
          acceptedRiskUntil: toStatus === IssueStatus.ACCEPTED_RISK ? acceptedRiskUntil : null,
        },
      });
    });

    return this.findOne(id, userId);
  }

  async assign(id: string, userId: string, assigneeId: string | null) {
    const issue = await this.prisma.securityIssue.findFirst({
      where: { id, project: { userId } },
      select: { id: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    /*
     * The assignee is verified before the write.
     *
     * `SecurityIssue.assigneeId` carries a foreign key, so an unknown id used
     * to surface as a Prisma constraint violation and reach the client as a
     * 500. It is a bad request, not a server fault, and it should say so.
     * Inactive accounts are rejected for the same reason they are absent from
     * the picker: assigning work to a disabled account hides the issue.
     */
    if (assigneeId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: assigneeId, isActive: true },
        select: { id: true },
      });
      if (!assignee) {
        throw new BadRequestException('Assignee must be an active user.');
      }
    }

    await this.prisma.securityIssue.update({ where: { id }, data: { assigneeId } });
    return this.findOne(id, userId);
  }

  /** Aggregates over current issues, for dashboards. */
  async getStats(userId: string, projectId?: string) {
    const where: Prisma.SecurityIssueWhereInput = {
      project: { userId, isActive: true, ...(projectId ? { id: projectId } : {}) },
    };

    const [bySeverity, byStatus, byOwasp, total, open] = await Promise.all([
      this.prisma.securityIssue.groupBy({
        by: ['severity'],
        where: { ...where, status: { in: OPEN_ISSUE_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.securityIssue.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.securityIssue.groupBy({
        by: ['owaspCategory'],
        where: { ...where, status: { in: OPEN_ISSUE_STATUSES } },
        _count: { _all: true },
        orderBy: { _count: { owaspCategory: 'desc' } },
        take: 10,
      }),
      this.prisma.securityIssue.count({ where }),
      this.prisma.securityIssue.count({ where: { ...where, status: { in: OPEN_ISSUE_STATUSES } } }),
    ]);

    return { bySeverity, byStatus, byOwasp, total, open };
  }

  /** The detections a single scan produced. Immutable history, not current state. */
  async findOccurrencesByAssessment(assessmentId: string, userId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, project: { userId } },
      select: { id: true },
    });
    if (!assessment) throw new NotFoundException('Scan not found');

    return this.prisma.findingOccurrence.findMany({
      where: { assessmentId },
      orderBy: [{ severitySnapshot: 'asc' }, { detectedAt: 'desc' }],
      include: {
        issue: {
          select: { id: true, status: true, firstSeenAt: true, lastSeenAt: true, occurrenceCount: true },
        },
      },
    });
  }

  private parseStatus(value: string): IssueStatus {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !(normalized in IssueStatus)) {
      throw new BadRequestException(
        `Unknown issue status "${value}". Expected one of: ${Object.keys(IssueStatus).join(', ')}.`,
      );
    }
    return normalized as IssueStatus;
  }

  private parseSeverity(value: string): Severity {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !(normalized in Severity)) {
      throw new BadRequestException(
        `Unknown severity "${value}". Expected one of: ${Object.keys(Severity).join(', ')}.`,
      );
    }
    return normalized as Severity;
  }
}

/** Turns a stored failure code into something a user can act on. */
function describeGuidanceFailure(errorCode: string | null): string {
  switch (errorCode) {
    case 'PROVIDER_UNAVAILABLE':
      return 'The AI provider rejected the request — it may be rate limited, out of quota, or misconfigured. Scanner evidence is unaffected.';
    case 'NOT_JSON':
    case 'NOT_AN_OBJECT':
    case 'MISSING_REQUIRED_FIELDS':
      return 'The AI provider returned a response that could not be validated. Scanner evidence is unaffected.';
    case 'EMPTY_RESPONSE':
      return 'The AI provider returned an empty response. Scanner evidence is unaffected.';
    default:
      return 'AI guidance could not be generated for this issue. Scanner evidence is unaffected.';
  }
}
