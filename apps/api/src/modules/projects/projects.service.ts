import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto, SaveProjectDraftDto, UpdateProjectDto } from './dto/create-project.dto';
import SwaggerParser = require('swagger-parser');
import axios from 'axios';
import { assertSafeRemoteUrl, resolveTargetUrl } from '../../common/utils/url-resolver.util';
import { CryptoService } from '../../common/crypto/crypto.service';
import { encryptAuthFields, stripAuthSecrets } from '../../common/crypto/auth-config.crypto';
import {
  assertNoExternalRefs,
  isOpenApi31Document,
  SAFE_PARSER_OPTIONS,
} from '../../common/utils/openapi-safety.util';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ReportStorageService } from '../reports/report-storage.service';
import { REPORTS_QUEUE } from '../reports/auto-report.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private events: EventEmitter2,
    private settings: SettingsService,
    private audit: AuditService,
    private reportStorage: ReportStorageService,
    @InjectQueue('scanner') private scannerQueue: Queue,
    @InjectQueue(REPORTS_QUEUE) private reportsQueue: Queue,
  ) {}

  /**
   * Announces a change to a project.
   *
   * Drafts are deliberately excluded by the callers: the wizard autosaves on a
   * timer, so recording every keystroke-driven save would drown the event stream
   * in rows describing a project that does not exist yet.
   */
  private announce(
    change: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    project: { id: string; name: string },
    userId: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    this.events.emit('project.changed', {
      projectId: project.id,
      projectName: project.name,
      action,
      change,
      message,
      userId,
      metadata,
    });
  }

  /**
   * Every active project in the installation, not just the caller's own.
   *
   * There is no organization/tenant boundary in this product: one installation
   * is one company, and every authenticated user in it works against the same
   * projects — the way Wazuh or any other shared security console does.
   * `userId` on `Project` still records who created it; it stops being an
   * access filter.
   */
  async findAll() {
    const projects = await this.prisma.project.findMany({
      where: { isActive: true },
      include: {
        apiSpec: {
          include: { authConfig: true },
        },
        _count: {
          select: {
            assessments: true,
            // Open issues now hang off the project directly, so the count is a
            // single indexed query rather than a sum over every scan.
            securityIssues: { where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK'] } } },
          },
        },
        assessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map(({ assessments, ...project }) => ({
      ...this.toProjectResponse(project),
      // Vulnerabilities currently open on this project — not the number of
      // times they have been detected. Previously this summed findings across
      // every scan, so rescanning an unchanged API inflated the number.
      openIssuesCount: project._count.securityIssues,
      lastScanStatus: assessments[0]?.status ?? null,
    }));
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, isActive: true },
      include: {
        apiSpec: {
          include: {
            authConfig: true,
            endpoints: { orderBy: [{ path: 'asc' }, { method: 'asc' }] },
          },
        },
        assessments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            summary: true,
          },
        },
        _count: { select: { assessments: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');
    return this.toProjectResponse(project);
  }

  async create(userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        baseUrl: dto.baseUrl,
        environment: dto.environment || 'DEVELOPMENT',
        tags: dto.tags || [],
        userId,
        status: 'DRAFT',
        setupStep: 2,
      },
    });

    this.announce('created', 'CREATE', project, userId, `Project "${project.name}" created`, {
      environment: project.environment,
      baseUrl: project.baseUrl,
    });

    return project;
  }

  async createDraft(userId: string, dto: SaveProjectDraftDto) {
    if (![dto.name, dto.baseUrl, dto.description].some((value) => value?.trim())) {
      throw new BadRequestException({ message: 'Enter project information before saving a draft.', fieldErrors: {} });
    }
    return this.prisma.project.create({
      data: {
        name: dto.name?.trim() || 'Untitled project',
        description: dto.description,
        baseUrl: dto.baseUrl?.trim() || '',
        environment: dto.environment || 'DEVELOPMENT',
        setupStep: dto.setupStep || 1,
        status: 'DRAFT',
        userId,
      },
    });
  }

  async saveDraft(id: string, dto: SaveProjectDraftDto) {
    const project = await this.assertExists(id);
    if (project.status !== 'DRAFT') throw new BadRequestException('Only drafts can be autosaved.');
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  async finalize(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, isActive: true },
      include: { apiSpec: { include: { authConfig: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.status === 'READY') return project;
    const fieldErrors: Record<string, string> = {};
    if (!project.name.trim()) fieldErrors.name = 'Project name is required.';
    try { new URL(project.baseUrl); } catch { fieldErrors.baseUrl = 'Enter a valid API base URL.'; }
    if (!project.apiSpec) fieldErrors.specUrl = 'Upload a valid OpenAPI JSON or YAML document.';
    else if (!this.isAuthComplete(project.apiSpec.authConfig)) {
      fieldErrors.authType = 'Complete the authentication configuration.';
    }
    if (Object.keys(fieldErrors).length) {
      throw new BadRequestException({ message: 'Complete the required project setup.', fieldErrors });
    }
    return this.prisma.project.update({
      where: { id },
      data: { status: 'READY', setupStep: 3, completedAt: new Date() },
      include: { apiSpec: { select: { id: true, title: true, version: true, source: true } }, _count: { select: { assessments: true } } },
    });
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    await this.assertExists(id);
    const project = await this.prisma.project.update({
      where: { id },
      data: dto,
    });

    this.announce('updated', 'UPDATE', project, userId, `Project "${project.name}" updated`, {
      // The field names only. Values can carry a base URL with credentials in
      // it, and the trail needs to say what changed, not restate the payload.
      fields: Object.keys(dto),
    });

    return project;
  }

  /**
   * Permanently deletes a project and everything that exists only because of
   * it — API spec, endpoints, auth config, assessments, security issues,
   * occurrences, triage history, reports, scheduled scans.
   *
   * Existence is re-verified before anything else runs (`assertExists` throws
   * a plain 404, since any authenticated user in the installation may act on
   * any project — see `findAll`).
   *
   * The actual row removal is a single `project.delete()`. Every dependent
   * table cascades from `Project` through real Postgres foreign keys
   * (`onDelete: Cascade` in schema.prisma) — Assessment, SecurityIssue,
   * ApiSpec and everything under them — so the database does the cascading
   * work atomically; this method does not walk the tree itself. Two things a
   * foreign key cannot reach are cleaned up explicitly around that call:
   *
   *   1. In-flight BullMQ jobs (a running scan, a queued PDF render) reference
   *      an assessment/report id that is about to disappear. Left alone, the
   *      worker would either error against rows it can no longer find or,
   *      worse, silently write a result nobody can see. Removed best-effort —
   *      a job already claimed by a worker cannot be pulled out from under it
   *      (see the same trade-off in `AssessmentsService.cancel`), and that is
   *      an acceptable race for a delete: the processor tolerates a missing
   *      assessment.
   *   2. Report PDFs live on disk (`ReportStorageService`), not in Postgres.
   *      The DB cascade removes the `Report` rows; the bytes are only removed
   *      by calling the storage service, which this method does after the
   *      cascade succeeds, using file names read before the rows disappeared.
   *
   * `AuditLog` and `Notification` reference the project by a
   * plain string column rather than a foreign key specifically so a deletion
   * like this one cannot cascade the evidence of itself away — see the model
   * comments on those tables. This method's own audit entry is written after
   * the delete succeeds, once it is known what was actually removed.
   *
   * This used to be a soft delete (`isActive = false`) so a project's scan
   * history stayed browsable after "deleting" it. That is no longer the
   * behaviour: this endpoint now destroys the data. Callers that want the
   * project hidden without destroying its history should stop calling
   * `DELETE` for that purpose.
   */
  async remove(id: string, userId: string) {
    const project = await this.assertExists(id);

    const [jobBearingAssessments, reports, securityIssueCount] = await Promise.all([
      this.prisma.assessment.findMany({
        where: { projectId: id, jobId: { not: null } },
        select: { id: true, jobId: true },
      }),
      this.prisma.report.findMany({
        where: { assessment: { projectId: id } },
        select: { id: true, filePath: true },
      }),
      this.prisma.securityIssue.count({ where: { projectId: id } }),
    ]);

    await Promise.all([
      ...jobBearingAssessments.map(({ id: assessmentId, jobId }) =>
        this.removeQueuedJob(this.scannerQueue, jobId!, `scan ${assessmentId}`),
      ),
      ...reports.map(({ id: reportId }) =>
        this.removeQueuedJob(this.reportsQueue, `report-${reportId}`, `report ${reportId}`),
      ),
    ]);

    // One statement; Postgres cascades every dependent row via the foreign
    // keys declared in schema.prisma. If this throws, nothing above has
    // mutated any row this method is responsible for, so there is nothing to
    // roll back — the queue removals were already-orphaned jobs regardless of
    // outcome.
    await this.prisma.project.delete({ where: { id } });

    const filePaths = reports.map((r) => r.filePath).filter((path): path is string => Boolean(path));
    await Promise.all(filePaths.map((path) => this.reportStorage.delete(path)));

    this.audit.log({
      userId,
      action: AuditAction.DELETE,
      resource: 'project',
      resourceId: id,
      metadata: {
        name: project.name,
        assessmentsWithJobsCancelled: jobBearingAssessments.length,
        reportsDeleted: reports.length,
        reportFilesDeleted: filePaths.length,
        securityIssuesDeleted: securityIssueCount,
      },
    });

    this.announce('deleted', 'DELETE', project, userId, `Project "${project.name}" permanently deleted`, {
      reportsDeleted: reports.length,
      securityIssuesDeleted: securityIssueCount,
    });

    return { id, name: project.name };
  }

  /**
   * Best-effort BullMQ job removal for a job about to be orphaned by a hard
   * delete. Mirrors `AssessmentsService.cancel`: a job a worker already holds
   * a lock on cannot be pulled out, so it is discarded (no retries) instead —
   * the worker itself tolerates the rows it depended on disappearing under it.
   */
  private async removeQueuedJob(queue: Queue, jobId: string, description: string) {
    try {
      const job = await queue.getJob(jobId);
      if (!job) return;
      try {
        await job.remove();
      } catch (err) {
        this.logger.log(
          `${description} job is in flight during project deletion; discarding instead of removing (${(err as Error).message})`,
        );
        await job.discard();
      }
    } catch (err) {
      this.logger.warn(`Could not clean up queued job for ${description}: ${(err as Error).message}`);
    }
  }

  async importOpenApiFromUrl(projectId: string, userId: string, url: string) {
    await this.assertExists(projectId);

    const allowPrivate = await this.settings.getBoolean('scanner.allowPrivateTargets');
    const validatedUrl = await assertSafeRemoteUrl(url, allowPrivate);
    const resolvedUrl = resolveTargetUrl(validatedUrl);
    this.logger.log(`Importing OpenAPI spec from ${new URL(validatedUrl).hostname}`);

    let rawSpec: any;
    try {
      const response = await axios.get(resolvedUrl, {
        timeout: 15000,
        maxRedirects: 0,
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024,
        responseType: 'json',
        headers: { Accept: 'application/json, application/yaml, text/yaml' },
      });
      rawSpec = response.data;
    } catch (error) {
      this.logger.warn(`Specification URL import failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new BadRequestException('We could not access the specification URL.');
    }

    return this.parseAndSaveSpec(projectId, rawSpec, 'URL', userId, url);
  }

  async importOpenApiFromContent(
    projectId: string,
    userId: string,
    content: object,
  ) {
    await this.assertExists(projectId);
    return this.parseAndSaveSpec(projectId, content, 'UPLOAD', userId);
  }

  private async parseAndSaveSpec(
    projectId: string,
    rawSpec: any,
    source: 'URL' | 'UPLOAD' | 'MANUAL',
    userId: string,
    url?: string,
  ) {
    // Must run before dereference: dereferencing is what performs the fetch.
    // Applies to uploads as well as URL imports, since an uploaded document can
    // carry external refs that would otherwise bypass assertSafeRemoteUrl.
    assertNoExternalRefs(rawSpec);

    let parsed: any;
    if (isOpenApi31Document(rawSpec)) {
      // swagger-parser v10 rejects 3.1 documents even when they are otherwise
      // valid. Endpoint operations are usable without dereferencing; external
      // refs were already rejected above and internal schema refs remain safe.
      parsed = rawSpec;
      this.logger.log('Importing OpenAPI 3.1 document without parser dereference');
    } else {
      try {
        parsed = await SwaggerParser.dereference(rawSpec as any, SAFE_PARSER_OPTIONS as any);
      } catch (err) {
        this.logger.warn(`Could not fully dereference spec: ${err.message}`);
        throw new BadRequestException('Upload a valid OpenAPI JSON or YAML document.');
      }
    }

    const endpoints = this.extractEndpoints(parsed);
    if (!parsed?.openapi && !parsed?.swagger) throw new BadRequestException('Upload a valid OpenAPI document.');
    if (!parsed?.paths || endpoints.length === 0) throw new BadRequestException('The specification does not contain any valid endpoints.');

    const apiSpec = await this.prisma.apiSpec.upsert({
      where: { projectId },
      update: {
        source,
        url,
        rawSpec: rawSpec as any,
        parsed: parsed as any,
        title: parsed.info?.title,
        version: parsed.info?.version,
        endpoints: {
          deleteMany: {},
          create: endpoints,
        },
      },
      create: {
        projectId,
        source,
        url,
        rawSpec: rawSpec as any,
        parsed: parsed as any,
        title: parsed.info?.title,
        version: parsed.info?.version,
        endpoints: { create: endpoints },
      },
      include: {
        endpoints: true,
        authConfig: true,
      },
    });

    this.logger.log(
      `Parsed ${endpoints.length} endpoints from spec for project ${projectId}`,
    );

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: { setupStep: 3 },
      select: { id: true, name: true },
    });

    this.announce(
      'spec.imported',
      'UPDATE',
      project,
      userId,
      `OpenAPI specification imported for "${project.name}" — ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} discovered`,
      {
        source,
        // Where the surface came from — the first question asked of an import.
        url: url ?? null,
        endpointCount: endpoints.length,
        title: parsed.info?.title,
        version: parsed.info?.version,
      },
    );

    return apiSpec;
  }

  private extractEndpoints(spec: any) {
    const endpoints: any[] = [];
    const paths = spec.paths || {};

    for (const [path, pathItem] of Object.entries<any>(paths)) {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

      for (const method of methods) {
        if (!pathItem[method]) continue;

        const operation = pathItem[method];
        endpoints.push({
          path,
          method: method.toUpperCase(),
          summary: operation.summary,
          description: operation.description,
          operationId: operation.operationId,
          tags: operation.tags || [],
          parameters: operation.parameters || [],
          requestBody: operation.requestBody || null,
          responses: operation.responses || {},
          security: operation.security || spec.security || [],
          deprecated: operation.deprecated || false,
        });
      }
    }

    return endpoints;
  }

  async saveAuthConfig(
    projectId: string,
    authData: any,
  ) {
    await this.assertExists(projectId);

    const apiSpec = await this.prisma.apiSpec.findUnique({ where: { projectId } });
    if (!apiSpec) throw new NotFoundException('API spec not found. Please import a spec first.');

    const allowedTypes = ['NONE', 'BEARER', 'BASIC', 'API_KEY', 'OAUTH2'];
    if (!allowedTypes.includes(authData.type)) throw new BadRequestException('Select a valid authentication type.');
    if (authData.type === 'BEARER' && !authData.token?.trim()) throw new BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { token: 'A bearer token is required.' } });
    if (authData.type === 'BASIC' && (!authData.username?.trim() || !authData.password)) throw new BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { username: !authData.username?.trim() ? 'Username is required.' : undefined, password: !authData.password ? 'Password is required.' : undefined } });
    if (authData.type === 'API_KEY' && (!authData.apiKey || !authData.apiKeyHeader?.trim())) throw new BadRequestException({ message: 'Authentication is incomplete.', fieldErrors: { apiKey: !authData.apiKey ? 'An API key is required.' : undefined, apiKeyHeader: !authData.apiKeyHeader?.trim() ? 'Key name is required.' : undefined } });
    if (authData.type === 'OAUTH2' && (!authData.clientId || !authData.clientSecret || !authData.tokenUrl)) throw new BadRequestException('OAuth 2.0 configuration is incomplete.');
    const safeAuthData = Object.fromEntries(Object.entries(authData).filter(([key]) => ['type', 'token', 'username', 'password', 'apiKey', 'apiKeyHeader', 'apiKeyLocation', 'clientId', 'clientSecret', 'tokenUrl', 'scopes'].includes(key)));

    // Encrypt every credential before it touches the database. This is
    // idempotent, so re-saving never double-encrypts.
    const encrypted = encryptAuthFields(this.crypto, safeAuthData);

    const result = await this.prisma.authConfig.upsert({
      where: { apiSpecId: apiSpec.id },
      update: encrypted,
      create: { apiSpecId: apiSpec.id, ...encrypted } as any,
    });
    await this.prisma.project.update({ where: { id: projectId }, data: { setupStep: 3 } });

    // Never echo credentials back to the client — not even the ciphertext.
    return stripAuthSecrets(result);
  }

  private async assertExists(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private toProjectResponse<T extends { name: string; baseUrl: string; status: string; setupStep: number; apiSpec?: any }>(project: T) {
    const firstIncompleteStep = this.getFirstIncompleteStep(project);
    const apiSpec = project.apiSpec
      ? { ...project.apiSpec, authConfig: this.sanitizeAuthConfig(project.apiSpec.authConfig) }
      : project.apiSpec;
    return {
      ...project,
      apiSpec,
      setupStep: project.status === 'DRAFT' ? firstIncompleteStep ?? 3 : 3,
    };
  }

  private getFirstIncompleteStep(project: { name: string; baseUrl: string; apiSpec?: any }): 1 | 2 | 3 | null {
    if (!project.name.trim() || !this.isValidUrl(project.baseUrl)) return 1;
    if (!project.apiSpec) return 2;
    if (!this.isAuthComplete(project.apiSpec.authConfig)) return 3;
    return null;
  }

  private isValidUrl(value: string) {
    try { new URL(value); return true; } catch { return false; }
  }

  private isAuthComplete(authConfig?: any) {
    if (!authConfig) return false;
    if (authConfig.type === 'NONE') return true;
    if (authConfig.type === 'BEARER') return Boolean(authConfig.token?.trim());
    if (authConfig.type === 'BASIC') return Boolean(authConfig.username?.trim() && authConfig.password);
    if (authConfig.type === 'API_KEY') return Boolean(authConfig.apiKey && authConfig.apiKeyHeader?.trim());
    if (authConfig.type === 'OAUTH2') return Boolean(authConfig.clientId && authConfig.clientSecret && this.isValidUrl(authConfig.tokenUrl ?? ''));
    return false;
  }

  private sanitizeAuthConfig(authConfig?: any) {
    return stripAuthSecrets(authConfig);
  }
}
