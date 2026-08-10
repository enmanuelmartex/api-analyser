import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IssuesService } from './issues.service';
import { AssignIssueDto, IssueQueryDto, UpdateIssueStatusDto } from './dto/issue.dto';
import { AuditService } from '../audit/audit.service';

/**
 * Persistent vulnerabilities.
 *
 * Replaces `/findings`, which returned one row per detection and therefore
 * showed the same vulnerability once per scan. Scan-specific detections are
 * available under `/issues/occurrences/assessment/:id`, kept explicitly separate
 * so the two are never conflated.
 */
@ApiTags('Issues')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('issues')
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List persistent issues (deduplicated, paginated)' })
  findAll(@CurrentUser() user: any, @Query() query: IssueQueryDto) {
    return this.issues.findAll(user.id, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate counts over current issues' })
  getStats(@CurrentUser() user: any, @Query('projectId') projectId?: string) {
    return this.issues.getStats(user.id, projectId);
  }

  @Get('occurrences/assessment/:assessmentId')
  @ApiOperation({ summary: 'Detections produced by one scan' })
  findOccurrences(@Param('assessmentId') assessmentId: string, @CurrentUser() user: any) {
    return this.issues.findOccurrencesByAssessment(assessmentId, user.id);
  }

  /**
   * GET /issues/:id/guidance — AI security guidance for one issue.
   *
   * Separate from the issue payload on purpose: guidance is advisory and may be
   * absent, stale or failed, and the issue screen must render fully without it.
   * Keeping it on its own route also keeps the evidence response free of any
   * model-generated text.
   */
  @Get(':id/guidance')
  @ApiOperation({ summary: 'AI security guidance for an issue' })
  getGuidance(@Param('id') id: string, @CurrentUser() user: any) {
    return this.issues.getGuidance(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Issue detail with occurrence history and triage timeline' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.issues.findOne(id, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Apply a triage decision' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateIssueStatusDto,
  ) {
    const issue = await this.issues.updateStatus(id, user.id, dto);

    /*
     * Triage is the most audit-relevant action in the product: marking a real
     * vulnerability as a false positive or an accepted risk is a decision
     * somebody must be able to answer for later.
     *
     * `IssueStatusChange` already records this per issue; the audit log is the
     * cross-cutting view, queryable by actor rather than by issue. The
     * justification text is deliberately not copied here — it lives on the
     * status change row, and duplicating free-form user text into a second
     * store only widens the surface for something sensitive to be pasted into.
     */
    this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      resource: 'issue',
      resourceId: id,
      metadata: {
        toStatus: dto.status,
        hasJustification: Boolean(dto.reason),
        acceptedRiskUntil: dto.acceptedRiskUntil ?? null,
      },
    });

    return issue;
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: 'Assign or unassign an issue' })
  async assign(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AssignIssueDto) {
    const issue = await this.issues.assign(id, user.id, dto.assigneeId ?? null);

    this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      resource: 'issue',
      resourceId: id,
      metadata: { assigneeId: dto.assigneeId ?? null },
    });

    return issue;
  }
}
