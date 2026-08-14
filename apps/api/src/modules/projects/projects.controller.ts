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
  /*
   * Project lifecycle events are recorded by ProjectsService, which emits
   * `project.changed` on the bus. They used to be recorded here as well, so
   * every create and update wrote two rows — one with a message and one
   * without. The service is the right side of that pair: it is where the
   * project's name is known, and it covers callers that do not come through
   * this controller.
   */
  create(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.id, dto);
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
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.remove(id, user.id);
  }

  @Post(':id/spec/url')
  @ApiOperation({ summary: 'Import OpenAPI spec from URL' })
  async importFromUrl(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('url') url: string,
  ) {
    // Recorded by the service as `project.spec.imported`, which carries the
    // source URL a reviewer needs plus the endpoint count this cannot know.
    return this.projectsService.importOpenApiFromUrl(id, user.id, url);
  }

  @Post(':id/spec/upload')
  @ApiOperation({ summary: 'Import OpenAPI spec from uploaded content' })
  async importFromUpload(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('spec') spec: object,
  ) {
    // The document itself is never recorded — it can be large and may embed
    // example credentials. The service records the import and its scope.
    return this.projectsService.importOpenApiFromContent(id, user.id, spec);
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
