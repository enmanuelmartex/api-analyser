import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AssessmentsService } from './assessments.service';
import { RunAssessmentDto } from './dto/run-assessment.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('Assessments')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private assessmentsService: AssessmentsService,
    private audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List assessments' })
  findAll(@Query('projectId') projectId?: string) {
    return this.assessmentsService.findAll(projectId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  getDashboard() {
    return this.assessmentsService.getDashboardStats();
  }

  // Declared before ':id' so the two-segment path is not captured by it.
  @Get('projects/:projectId')
  @ApiOperation({ summary: "List a project's assessments (paginated, newest first)" })
  findByProject(
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.assessmentsService.findByProjectPaginated(
      projectId,
      page ? Number.parseInt(page, 10) : undefined,
      pageSize ? Number.parseInt(pageSize, 10) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get assessment details' })
  findOne(@Param('id') id: string) {
    return this.assessmentsService.findOne(id);
  }

  @Post('projects/:projectId/run')
  @Roles('ADMIN', 'ANALYST')
  @ApiOperation({ summary: 'Create and run a new assessment' })
  async createAndRun(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Body() config: RunAssessmentDto,
  ) {
    const assessment = await this.assessmentsService.createAndRun(projectId, user.id, config);

    /*
     * Audited after the call, so a rejected run (unknown check id, project not
     * ready) does not leave a record claiming a scan started. The metadata
     * carries the execution mode and the resolved selection — enough to answer
     * "what was actually tested" later — and no credential or target secret.
     */
    this.audit.log({
      userId: user.id,
      action: AuditAction.SCAN_START,
      resource: 'assessment',
      resourceId: assessment?.id,
      metadata: {
        projectId,
        executionMode: config?.executionMode ?? 'all',
        scanProfileId: config?.scanProfileId,
      },
    });

    return assessment;
  }

  @Delete(':id')
  @Roles('ADMIN', 'ANALYST')
  @ApiOperation({ summary: 'Cancel a running assessment' })
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.assessmentsService.cancel(id, user.id);

    this.audit.log({
      userId: user.id,
      action: AuditAction.SCAN_STOP,
      resource: 'assessment',
      resourceId: id,
    });

    return result;
  }

  @Sse(':id/progress')
  @ApiOperation({ summary: 'Stream assessment progress via SSE' })
  async streamProgress(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    return this.assessmentsService.streamProgress(id);
  }
}
