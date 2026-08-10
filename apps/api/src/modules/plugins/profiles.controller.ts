import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { AuditService } from '../audit/audit.service';
import { CreateScanProfileDto, UpdateScanProfileDto } from './dto/scan-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('plugins/profiles')
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly audit: AuditService,
  ) {}

  // GET /plugins/profiles
  @Get()
  findAll(@Request() req: any) {
    return this.profilesService.findAll(req.user.id);
  }

  // GET /plugins/profiles/:id
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.profilesService.findOne(id, req.user.id);
  }

  // POST /plugins/profiles
  @Post()
  async create(@Body() body: CreateScanProfileDto, @Request() req: any) {
    const profile = await this.profilesService.create(req.user.id, body);

    this.audit.log({
      userId: req.user.id,
      action: AuditAction.CREATE,
      resource: 'scanProfile',
      resourceId: profile?.id,
      metadata: { name: body.name, checks: body.enabledPlugins },
    });

    return profile;
  }

  // PUT /plugins/profiles/:id
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateScanProfileDto,
    @Request() req: any,
  ) {
    const profile = await this.profilesService.update(id, req.user.id, body);

    this.audit.log({
      userId: req.user.id,
      action: AuditAction.UPDATE,
      resource: 'scanProfile',
      resourceId: id,
      metadata: { fields: Object.keys(body ?? {}) },
    });

    return profile;
  }

  // DELETE /plugins/profiles/:id
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    const result = await this.profilesService.remove(id, req.user.id);

    this.audit.log({
      userId: req.user.id,
      action: AuditAction.DELETE,
      resource: 'scanProfile',
      resourceId: id,
    });

    return result;
  }
}
