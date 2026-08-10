import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { AuditAction } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(
    private users: UsersService,
    private audit: AuditService,
  ) {}

  // ── Static routes first (must come before :id to avoid param capture) ────────

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get('audit-logs')
  getAuditLogs(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
  ) {
    return this.audit.findAll({
      userId,
      action: action as AuditAction | undefined,
      resource,
      limit,
      offset,
    });
  }

  @Post('invite')
  invite(@Body() dto: InviteUserDto, @CurrentUser() actor: any) {
    return this.users.sendInvitation(dto, actor.id);
  }

  /**
   * GET /users/assignable — the directory an assignee picker needs.
   *
   * `@Roles()` clears the controller-level ADMIN requirement: assigning an
   * issue is ordinary triage, so gating the list to admins would make the
   * assignee field unusable for exactly the people who work the queue.
   *
   * Deliberately narrow — id, name, email and role of active accounts only. No
   * password hash, no last-login, no invitation state. Declared before the
   * `:id` route so the literal path wins the match.
   */
  @Roles()
  @Get('assignable')
  listAssignable() {
    return this.users.findAssignable();
  }

  @Public()
  @Roles()
  @Get('verify-invite')
  verifyInvite(@Query('token') token: string) {
    if (!token) throw new NotFoundException('Token is required');
    return this.users.verifyInvitation(token);
  }

  @Roles()
  @Post('accept-invite')
  acceptInvite(@Body('token') token: string, @CurrentUser() user: any) {
    return this.users.acceptInvitation(token, user.id);
  }

  // ── Dynamic :id routes ────────────────────────────────────────────────────

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: any) {
    return this.users.create(dto, actor.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: any) {
    return this.users.update(id, dto, actor.id);
  }

  @Patch(':id/role')
  changeRole(@Param('id') id: string, @Body() dto: ChangeRoleDto, @CurrentUser() actor: any) {
    return this.users.changeRole(id, dto.role, actor.id);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() actor: any) {
    return this.users.setActive(id, dto.isActive, actor.id);
  }

  @Post(':id/password-reset')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: any,
  ) {
    return this.users.resetPassword(id, dto.newPassword, actor.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.users.remove(id, actor.id);
  }
}
