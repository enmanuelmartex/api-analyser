import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { AuditService } from '../audit/audit.service';
import {
  contentDisposition,
  isReportFormat,
  isReportType,
  type ReportFormat,
  type ReportType,
} from './report-artifact';

/**
 * Reports.
 *
 * Generation and download are two different operations on purpose:
 *
 *   POST /reports/assessment/:assessmentId/generate  — may create a Report row
 *   GET  /reports/:id/download                       — never creates anything
 *
 * They used to be one endpoint. `GET /reports/assessment/:id/generate` rendered
 * a document, inserted a Report row and streamed the bytes, and the UI used it
 * for its "Download" button as well — so opening an existing report and clicking
 * Download inserted another row for the same scan, type and format. A GET that
 * creates a resource is also unsafe to retry, prefetch or cache, which is why
 * generation moved to POST rather than keeping the old verb.
 */
@ApiTags('Reports')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private audit: AuditService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Reports metrics and vulnerability trend' })
  getStats(@CurrentUser() user: any) {
    return this.reportsService.getStats(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List reports (latest version of each artifact)' })
  findAll(
    @CurrentUser() user: any,
    @Query('assessmentId') assessmentId?: string,
    @Query('includeHistory') includeHistory?: string,
  ) {
    return this.reportsService.findAll(user.id, {
      assessmentId,
      includeHistory: includeHistory === 'true',
    });
  }

  @Get('assessment/:assessmentId')
  @ApiOperation({ summary: 'List reports of one assessment' })
  findByAssessment(@Param('assessmentId') assessmentId: string, @CurrentUser() user: any) {
    return this.reportsService.findByAssessment(assessmentId, user.id);
  }

  @Get('assessment/:assessmentId/formats')
  @ApiOperation({ summary: 'Availability of every format for an assessment + report type' })
  formats(
    @Param('assessmentId') assessmentId: string,
    @CurrentUser() user: any,
    @Query('type') type = 'TECHNICAL',
  ) {
    if (!isReportType(type)) throw new BadRequestException(`Unsupported report type: ${type}`);
    return this.reportsService.findByAssessment(assessmentId, user.id).then(() =>
      this.reportsService.formatAvailability(assessmentId, type as ReportType),
    );
  }

  /**
   * Creates a report artifact.
   *
   * Idempotent unless `regenerate` is set: requesting a format that already
   * exists returns the existing report with `created: false`, so a double click
   * or a retried request cannot produce a second row.
   */
  @Post('assessment/:assessmentId/generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate a report artifact for an assessment' })
  async generate(
    @Param('assessmentId') assessmentId: string,
    @CurrentUser() user: any,
    @Body() body: { format?: string; type?: string; regenerate?: boolean } = {},
  ) {
    const format = body.format ?? 'PDF';
    const type = body.type ?? 'TECHNICAL';
    if (!isReportFormat(format)) throw new BadRequestException(`Unsupported report format: ${format}`);
    if (!isReportType(type)) throw new BadRequestException(`Unsupported report type: ${type}`);

    const result = await this.reportsService.generate(assessmentId, user.id, {
      format: format as ReportFormat,
      type: type as ReportType,
      regenerate: body.regenerate === true,
    });

    /*
     * Only a genuine creation is audited. `generate` is idempotent: asking for
     * a format that already exists returns it with `created: false`. Logging
     * those too would fill the trail with entries for what is really a read,
     * and hide the versions that were actually produced.
     */
    if (result?.created) {
      this.audit.log({
        userId: user.id,
        action: AuditAction.CREATE,
        resource: 'report',
        resourceId: result.report?.id,
        metadata: {
          assessmentId,
          format,
          type,
          version: result.report?.version,
          regenerated: body.regenerate === true,
        },
      });
    }

    return result;
  }

  /**
   * Streams an already generated artifact.
   *
   * Read-only by contract: no row is created, `generatedAt` is unchanged, and
   * the current findings are never consulted — the bytes come from the artifact
   * frozen at generation time. Ownership is resolved from the report id against
   * the authenticated user, so a foreign id is a 404 rather than a download.
   */
  @Get(':id/download')
  @ApiOperation({ summary: 'Download an existing report artifact' })
  async download(@Param('id') id: string, @CurrentUser() user: any, @Res() res: Response) {
    const artifact = await this.reportsService.resolveArtifact(id, user.id);

    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', contentDisposition(artifact.fileName));
    res.setHeader('Content-Length', artifact.bytes.length);
    // A report is a point-in-time document; caches must not serve one user's
    // artifact to another, and must not hold it after access is revoked.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(artifact.bytes);

    /*
     * Downloads are audited because a report is the one artifact that leaves
     * the system carrying findings and HTTP evidence. Knowing who exported one,
     * and when, is the point of an export trail.
     */
    this.audit.log({
      userId: user.id,
      action: AuditAction.EXPORT,
      resource: 'report',
      resourceId: id,
      metadata: { fileName: artifact.fileName },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get report details' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reportsService.findOne(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a report and its artifact' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.reportsService.remove(id, user.id);

    this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE,
      resource: 'report',
      resourceId: id,
    });

    return result;
  }
}
