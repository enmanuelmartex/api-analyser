import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ScoringService } from './scoring.service';
import { ComparisonService } from './comparison.service';

@ApiTags('Scoring')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller()
export class ScoringController {
  constructor(
    private readonly scoring: ScoringService,
    private readonly comparison: ComparisonService,
    private readonly prisma: PrismaService,
  ) {}

  /** Stored score snapshot for one scan. Never recomputed on read. */
  @Get('assessments/:id/score')
  @ApiOperation({ summary: 'Score snapshot and explanation for a scan' })
  getAssessmentScore(@Param('id') id: string) {
    return this.scoring.getAssessmentScore(id);
  }

  /** Current posture of a project, derived from its most recent scorable scan. */
  @Get('projects/:id/posture')
  @ApiOperation({ summary: 'Current security posture of a project' })
  async getProjectPosture(@Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.scoring.getProjectPosture(id);
  }

  @Get('assessments/:id/comparison')
  @ApiOperation({ summary: 'Compare a scan against a baseline' })
  compare(@Param('id') id: string, @Query('baseline') baseline?: string) {
    return this.comparison.compare(id, baseline);
  }

  @Get('assessments/:id/comparison/candidates')
  @ApiOperation({ summary: 'Scans that can serve as a comparison baseline' })
  candidates(@Param('id') id: string) {
    return this.comparison.getComparisonCandidates(id);
  }
}
