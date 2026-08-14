import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import type { LogCategory, LogSeverity } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from './audit.service';
import { LogStreamService } from './log-stream.service';
import { LogRetentionService } from './log-retention.service';
import { QueryLogsDto } from './dto/query-logs.dto';
import { PURGE_ALL_CONFIRMATION, PurgeLogsDto } from './dto/purge-logs.dto';

/**
 * The log explorer's API.
 *
 * ADMIN throughout. Logs carry IP addresses, routes, user agents and the
 * identity of everyone who touched the system — an analyst reviewing findings
 * has no reason to read them, and exposing them more widely turns the audit
 * trail into a reconnaissance surface.
 */
@ApiTags('audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(
    private audit: AuditService,
    private stream: LogStreamService,
    private retention: LogRetentionService,
    private settings: SettingsService,
  ) {}

  @Get('logs')
  @ApiOperation({ summary: 'Filtered, sorted, paginated event history' })
  findAll(@Query() query: QueryLogsDto) {
    return this.audit.findAll({
      search: query.search,
      severities: query.severity,
      categories: query.category,
      statuses: query.status,
      userId: query.userId,
      event: query.event,
      resource: query.resource,
      requestId: query.requestId,
      assessmentId: query.assessmentId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  @Get('logs/stats')
  @ApiOperation({ summary: 'Row counts, date range, on-disk size and active policy' })
  stats() {
    return this.audit.stats();
  }

  @Get('logs/events')
  @ApiOperation({ summary: 'Distinct event names present in the table' })
  events() {
    return this.audit.distinctEvents();
  }

  /**
   * Live tail.
   *
   * Declared before `logs/:id` so the literal segment wins the route match —
   * otherwise `stream` is captured as an id and every subscriber gets a 404.
   */
  @Sse('logs/stream')
  @ApiOperation({ summary: 'Server-sent stream of events as they are recorded' })
  async streamLogs(
    @Query('severity') severity?: string,
    @Query('category') category?: string,
  ): Promise<Observable<MessageEvent>> {
    if (!(await this.settings.getBoolean('logs.liveStreamEnabled'))) {
      throw new ForbiddenException('Live log streaming is disabled');
    }

    return this.stream.subscribe({
      severities: severity ? (severity.split(',').filter(Boolean) as LogSeverity[]) : undefined,
      categories: category ? (category.split(',').filter(Boolean) as LogCategory[]) : undefined,
    });
  }

  @Get('logs/:id')
  @ApiOperation({ summary: 'One event with its full metadata and stack trace' })
  async findOne(@Param('id') id: string) {
    const log = await this.audit.findOne(id);
    if (!log) throw new NotFoundException('Event not found');
    return log;
  }

  @Post('logs/cleanup')
  @ApiOperation({ summary: 'Apply the retention policy immediately' })
  async cleanup(@CurrentUser() actor: any) {
    return this.retention.runNow('manual', actor.id);
  }

  /**
   * Deletes stored logs.
   *
   * The audit event is written BEFORE the delete, not after: for `scope: all`
   * an event written afterwards would be the only row in an otherwise empty
   * table and would look like the start of history rather than the erasure of
   * it. Writing first means the record of the purge is itself purged, which is
   * honest — and the operator is told exactly that in the confirmation dialog.
   */
  @Post('logs/purge')
  @ApiOperation({ summary: 'Permanently delete stored log records' })
  async purge(@Body() dto: PurgeLogsDto, @CurrentUser() actor: any, @Req() req: any) {
    if (dto.scope === 'all' && dto.confirmation !== PURGE_ALL_CONFIRMATION) {
      throw new BadRequestException(
        `Deleting all logs requires the confirmation phrase "${PURGE_ALL_CONFIRMATION}"`,
      );
    }

    const before =
      dto.scope === 'all'
        ? null
        : new Date(Date.now() - (dto.scope === 'older-than-7-days' ? 7 : 30) * 24 * 60 * 60 * 1000);

    await this.audit.record({
      event: 'logs.purged',
      category: 'CONFIGURATION',
      severity: 'WARNING',
      status: 'SUCCESS',
      action: 'DELETE',
      resource: 'audit_log',
      userId: actor.id,
      ipAddress: req.ip,
      source: 'api',
      message:
        dto.scope === 'all'
          ? 'All stored log records were permanently deleted'
          : `Log records older than ${dto.scope === 'older-than-7-days' ? 7 : 30} days were permanently deleted`,
      metadata: { scope: dto.scope, before: before?.toISOString() ?? null },
    });

    const deleted = before ? await this.audit.deleteOlderThan(before) : await this.audit.deleteAll();

    return { deleted, scope: dto.scope };
  }
}
