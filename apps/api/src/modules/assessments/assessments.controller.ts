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
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AssessmentsService } from './assessments.service';
import { RunAssessmentDto } from './dto/run-assessment.dto';

@ApiTags('Assessments')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('assessments')
export class AssessmentsController {
  constructor(private assessmentsService: AssessmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List assessments' })
  findAll(
    @CurrentUser() user: any,
    @Query('projectId') projectId?: string,
  ) {
    return this.assessmentsService.findAll(user.id, projectId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  getDashboard(@CurrentUser() user: any) {
    return this.assessmentsService.getDashboardStats(user.id);
  }

  // Declared before ':id' so the two-segment path is not captured by it.
  @Get('projects/:projectId')
  @ApiOperation({ summary: "List a project's assessments (paginated, newest first)" })
  findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.assessmentsService.findByProjectPaginated(
      user.id,
      projectId,
      page ? Number.parseInt(page, 10) : undefined,
      pageSize ? Number.parseInt(pageSize, 10) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get assessment details' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.assessmentsService.findOne(id, user.id);
  }

  @Post('projects/:projectId/run')
  @ApiOperation({ summary: 'Create and run a new assessment' })
  createAndRun(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Body() config: RunAssessmentDto,
  ) {
    return this.assessmentsService.createAndRun(projectId, user.id, config);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a running assessment' })
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.assessmentsService.cancel(id, user.id);
  }

  @Sse(':id/progress')
  @ApiOperation({ summary: 'Stream assessment progress via SSE' })
  async streamProgress(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<Observable<MessageEvent>> {
    return this.assessmentsService.streamProgress(id, user.id);
  }
}
