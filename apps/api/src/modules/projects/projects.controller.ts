import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, SaveProjectDraftDto, UpdateProjectDto } from './dto/create-project.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('Projects')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private projectsService: ProjectsService,
    private audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all projects' })
  findAll(@CurrentUser() user: any) {
    return this.projectsService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.findOne(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  async create(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
    const project = await this.projectsService.create(user.id, dto);
    // `baseUrl` is the scan target and is already visible to this user; no
    // credential from the auth config is recorded here.
    this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE,
      resource: 'project',
      resourceId: project?.id,
      metadata: { name: dto.name, baseUrl: dto.baseUrl },
    });
    return project;
  }

  @Post('drafts')
  @ApiOperation({ summary: 'Create a meaningful project draft' })
  createDraft(@CurrentUser() user: any, @Body() dto: SaveProjectDraftDto) {
    return this.projectsService.createDraft(user.id, dto);
  }

  @Put(':id/draft')
  @ApiOperation({ summary: 'Autosave a project draft' })
  saveDraft(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: SaveProjectDraftDto) {
    return this.projectsService.saveDraft(id, user.id, dto);
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Validate and finalize a project draft' })
  finalize(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.finalize(id, user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a project' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.update(id, user.id, dto);
    this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      resource: 'project',
      resourceId: id,
      metadata: { fields: Object.keys(dto ?? {}) },
    });
    return project;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.projectsService.remove(id, user.id);
    this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE,
      resource: 'project',
      resourceId: id,
    });
    return result;
  }

  @Post(':id/spec/url')
  @ApiOperation({ summary: 'Import OpenAPI spec from URL' })
  async importFromUrl(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('url') url: string,
  ) {
    const result = await this.projectsService.importOpenApiFromUrl(id, user.id, url);
    // The source URL is the point of the record: it is what a reviewer needs
    // to know when asking where an API surface came from.
    this.audit.log({
      userId: user.id,
      action: AuditAction.IMPORT,
      resource: 'project.spec',
      resourceId: id,
      metadata: { source: 'url', url },
    });
    return result;
  }

  @Post(':id/spec/upload')
  @ApiOperation({ summary: 'Import OpenAPI spec from uploaded content' })
  async importFromUpload(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('spec') spec: object,
  ) {
    const result = await this.projectsService.importOpenApiFromContent(id, user.id, spec);
    // The document itself is not stored in the audit entry — it can be large
    // and may embed example credentials.
    this.audit.log({
      userId: user.id,
      action: AuditAction.IMPORT,
      resource: 'project.spec',
      resourceId: id,
      metadata: { source: 'upload' },
    });
    return result;
  }

  @Post(':id/auth')
  @ApiOperation({ summary: 'Save authentication configuration' })
  async saveAuth(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() authData: any,
  ) {
    const result = await this.projectsService.saveAuthConfig(id, user.id, authData);
    /*
     * Only the auth *type* is recorded. The token, password and API key in this
     * payload are encrypted at rest and never returned to a client; writing any
     * of them into an audit row — which is readable by admins in plain text —
     * would undo that.
     */
    this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      resource: 'project.authConfig',
      resourceId: id,
      metadata: { type: authData?.type ?? 'NONE' },
    });
    return result;
  }
}
