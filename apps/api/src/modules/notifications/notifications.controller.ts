import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationStreamService } from './notification-stream.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { SECTION_CATEGORIES, type NotificationSection } from './notification-catalog';

/** Narrows a path parameter to a known section without trusting the client. */
function isNotificationSection(value: string): value is NotificationSection {
  return Object.prototype.hasOwnProperty.call(SECTION_CATEGORIES, value);
}

/**
 * Notifications, scoped to the caller.
 *
 * No `RolesGuard`: every authenticated user has notifications and preferences
 * of their own. Authorisation is by ownership instead — every query and
 * mutation below is filtered by `user.id` in the service, so there is no
 * request shape that reaches another user's rows.
 */
@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private notifications: NotificationsService,
    private preferences: NotificationPreferencesService,
    private stream: NotificationStreamService,
  ) {}

  // ── Static routes first, so `preferences` is not captured as an id ─────────

  @Get('preferences')
  @ApiOperation({ summary: "The caller's notification preferences" })
  getPreferences(@CurrentUser() user: any) {
    return this.preferences.get(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update one or more preferences' })
  updatePreferences(@Body() dto: UpdatePreferencesDto, @CurrentUser() user: any) {
    return this.preferences.update(user.id, dto);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread totals, grouped by category' })
  unreadCount(@CurrentUser() user: any) {
    return this.notifications.unreadCounts(user.id);
  }

  /**
   * The single read the navigation makes.
   *
   * One request serves the sidebar badges, the bell and the notification
   * centre. Splitting it per section is what lets the three drift apart.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Unread totals for the bell and the sidebar badges' })
  summary(@CurrentUser() user: any) {
    return this.notifications.summary(user.id);
  }

  /**
   * Clears one section's badge.
   *
   * POST rather than PATCH on a collection the caller does not name, matching
   * `read-all` above. The section is validated against the catalog, so an
   * unknown value is a 400 and never a silent no-op.
   */
  @Post('sections/:section/read')
  @ApiOperation({ summary: 'Mark one section‘s unread notifications as read' })
  markSectionRead(@Param('section') section: string, @CurrentUser() user: any) {
    if (!isNotificationSection(section)) {
      throw new BadRequestException(
        `Unknown section '${section}'. Expected one of: ${Object.keys(SECTION_CATEGORIES).join(', ')}.`,
      );
    }
    return this.notifications.markSectionRead(user.id, section);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Server-sent stream of the caller‘s new notifications' })
  stream$(@CurrentUser() user: any): Observable<MessageEvent> {
    return this.stream.subscribe(user.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every unread notification as read' })
  markAllRead(@CurrentUser() user: any) {
    return this.notifications.markAllRead(user.id);
  }

  @Delete('read')
  @ApiOperation({ summary: 'Delete every notification already read' })
  removeAllRead(@CurrentUser() user: any) {
    return this.notifications.removeAllRead(user.id);
  }

  @Get()
  @ApiOperation({ summary: "The caller's notifications, newest first" })
  findAll(
    @CurrentUser() user: any,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('unreadOnly', new DefaultValuePipe(false), ParseBoolPipe) unreadOnly: boolean,
  ) {
    return this.notifications.findAll(user.id, { limit, offset, unreadOnly });
  }

  // ── Dynamic :id routes ────────────────────────────────────────────────────

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notifications.markRead(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one notification' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notifications.remove(id, user.id);
  }
}
