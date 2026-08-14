import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ScheduledScansService } from './scheduled-scans.service';
import { SchedulerService } from './scheduler.service';
import { CreateScheduledScanDto } from './dto/create-scheduled-scan.dto';
import { UpdateScheduledScanDto } from './dto/update-scheduled-scan.dto';
import { QueryScheduledScansDto } from './dto/query-scheduled-scans.dto';
import { listTimeZones } from './recurrence/zoned-time';

/**
 * REST surface for scheduled scans.
 *
 * Permissions follow the roles this product already has rather than inventing a
 * parallel permission vocabulary:
 *
 *   VIEWER  — may read schedules and their history. Read-only everywhere else
 *             in the product, and scheduling is no exception.
 *   ANALYST — may create, edit, pause, resume, delete and run schedules. This
 *             is the role that runs scans by hand, and a schedule is a scan
 *             that runs by itself.
 *   ADMIN   — everything an analyst may do.
 *
 * Ownership is enforced separately and always: every service method scopes its
 * query by `project: { userId }`, so a role never grants access to another
 * user's projects.
 */
@ApiTags('Scheduled Scans')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('scheduled-scans')
export class ScheduledScansController {
  constructor(
    private scheduledScans: ScheduledScansService,
    private scheduler: SchedulerService,
  ) {}

  // ── Static routes first, so `:id` cannot capture them ─────────────────────

  /**
   * Is the scheduler actually alive?
   *
   * Exists because the previous design could stop running entirely while every
   * schedule still displayed "Active" next to a next-run time that had already
   * passed. `lastTickAt` older than a couple of minutes means no schedule in
   * this installation is being honoured, whatever the list says.
   */
  @Get('health')
  @ApiOperation({ summary: 'Scheduler heartbeat status' })
  health() {
    const health = this.scheduler.getHealth();
    const staleAfterMs = health.intervalMs * 3;
    const healthy =
      health.running &&
      health.lastTickAt !== null &&
      Date.now() - health.lastTickAt.getTime() < staleAfterMs;

    return { ...health, healthy };
  }

  @Get()
  @ApiOperation({ summary: 'List scheduled scans (filtered, paginated)' })
  findAll(@CurrentUser() user: any, @Query() query: QueryScheduledScansDto) {
    return this.scheduledScans.findAll(user.id, query);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'The next few scheduled runs, for the dashboard' })
  upcoming(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.scheduledScans.upcoming(user.id, limit ? Number.parseInt(limit, 10) : undefined);
  }

  /**
   * The timezones the server can actually resolve, with their current offsets.
   *
   * Served from the API rather than hardcoded in the browser so the picker
   * offers exactly the zones the scheduler will accept, and shows the offset
   * that is in force right now rather than a stale constant.
   */
  @Get('timezones')
  @ApiOperation({ summary: 'Supported IANA timezones with their current UTC offset' })
  timezones() {
    return listTimeZones();
  }

  /**
   * Validates a proposed recurrence and describes it, without saving anything.
   *
   * The create form calls this as the operator edits, so the sentence under the
   * fields and the instants in the preview come from the same code that will
   * fire the schedule.
   */
  @Post('preview')
  @Roles('ADMIN', 'ANALYST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview a recurrence without creating it' })
  preview(@Body() dto: CreateScheduledScanDto) {
    return this.scheduledScans.preview(dto);
  }

  @Post()
  @Roles('ADMIN', 'ANALYST')
  @ApiOperation({ summary: 'Create a scheduled scan' })
  create(@CurrentUser() user: any, @Body() dto: CreateScheduledScanDto) {
    return this.scheduledScans.create(user.id, dto);
  }

  // ── Per-schedule routes ───────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get a scheduled scan' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.scheduledScans.findOne(id, user.id);
  }

  @Get(':id/executions')
  @ApiOperation({ summary: 'Execution history for one scheduled scan' })
  listExecutions(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.scheduledScans.listExecutions(
      id,
      user.id,
      page ? Number.parseInt(page, 10) : undefined,
      pageSize ? Number.parseInt(pageSize, 10) : undefined,
    );
  }

  @Patch(':id')
  @Roles('ADMIN', 'ANALYST')
  @ApiOperation({ summary: 'Update a scheduled scan' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateScheduledScanDto,
  ) {
    return this.scheduledScans.update(id, user.id, dto);
  }

  @Post(':id/pause')
  @Roles('ADMIN', 'ANALYST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a scheduled scan' })
  pause(@Param('id') id: string, @CurrentUser() user: any) {
    return this.scheduledScans.pause(id, user.id);
  }

  @Post(':id/resume')
  @Roles('ADMIN', 'ANALYST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused scheduled scan' })
  resume(@Param('id') id: string, @CurrentUser() user: any) {
    return this.scheduledScans.resume(id, user.id);
  }

  /**
   * Runs the schedule's configuration now. Never moves the next automatic run.
   */
  @Post(':id/run')
  @Roles('ADMIN', 'ANALYST')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run a scheduled scan immediately' })
  runNow(@Param('id') id: string, @CurrentUser() user: any) {
    return this.scheduledScans.runNow(id, user.id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ANALYST')
  @ApiOperation({ summary: 'Delete a scheduled scan (its past scans are kept)' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.scheduledScans.remove(id, user.id);
  }
}
