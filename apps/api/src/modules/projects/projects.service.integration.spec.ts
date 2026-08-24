import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { AuditService } from '../audit/audit.service';
import { ReportStorageService } from '../reports/report-storage.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * `DELETE /api/v1/projects/:id` used to be a soft delete (`isActive = false`).
 * It is now a real, cascading delete, so this suite proves what a unit test
 * cannot: that every table that exists only because of the project is
 * actually gone from the database afterwards — the cascade is declared in
 * real Postgres foreign keys, not application code.
 */

let prisma: PrismaClient;
let service: ProjectsService;
let storageRoot: string;

const OWNER = 'owner-user';
const OTHER = 'other-user';
const PROJECT = 'project-under-test';

function fakeQueue() {
  return {
    getJob: mock(async () => null),
  } as any;
}

/** Polls for the fire-and-forget audit write `ProjectsService.remove` triggers. */
async function waitForAuditEntries(projectId: string, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entries = await prisma.auditLog.findMany({ where: { resource: 'project', resourceId: projectId } });
    if (entries.length > 0 || Date.now() > deadline) return entries;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function seedFullProject(reportFilePath: string | null) {
  await prisma.user.create({ data: { id: OWNER, email: 'owner@test.local', name: 'Owner' } });
  await prisma.user.create({ data: { id: OTHER, email: 'other@test.local', name: 'Other' } });

  await prisma.project.create({
    data: { id: PROJECT, name: 'Doomed Project', baseUrl: 'https://doomed.test.local', userId: OWNER },
  });

  const apiSpec = await prisma.apiSpec.create({
    data: {
      projectId: PROJECT,
      source: 'UPLOAD',
      rawSpec: {},
      parsed: {},
      authConfig: { create: { type: 'BEARER', token: 'encrypted-token' } },
      endpoints: {
        create: [{ path: '/widgets', method: 'GET', tags: [], parameters: [], responses: {}, security: [] }],
      },
    },
    include: { endpoints: true },
  });

  const assessment = await prisma.assessment.create({
    data: {
      projectId: PROJECT,
      status: 'COMPLETED',
      jobId: 'bullmq-job-123',
      config: { create: { executionMode: 'all', resolvedPlugins: ['cors'] } },
      summary: { create: { securityScore: 42, scoreStatus: 'FINAL', scoreVersion: 'score-v2' } },
      logs: { create: [{ level: 'info', message: 'scan started' }] },
    },
  });

  const issue = await prisma.securityIssue.create({
    data: {
      projectId: PROJECT,
      fingerprint: 'fp-1',
      pluginId: 'cors',
      ruleId: 'cors.wildcard-origin',
      method: 'GET',
      normalizedRoute: '/widgets',
      component: 'endpoint',
      title: 'CORS wildcard',
      description: 'desc',
      severity: 'MEDIUM',
      owaspCategory: 'API8:2023',
      status: 'OPEN',
    } as any,
  });

  await prisma.findingOccurrence.create({
    data: {
      assessmentId: assessment.id,
      issueId: issue.id,
      endpointId: apiSpec.endpoints[0].id,
      occurrenceKey: `${assessment.id}-fp-1`,
      methodSnapshot: 'GET',
      pathSnapshot: '/widgets',
      pluginIdSnapshot: 'cors',
      pluginVersionSnapshot: '1.0.0',
      ruleIdSnapshot: 'cors.wildcard-origin',
      severitySnapshot: 'MEDIUM',
      owaspSnapshot: 'API8:2023',
      titleSnapshot: 'CORS wildcard',
      descriptionSnapshot: 'desc',
      location: 'endpoint',
      detectedAt: new Date(),
    } as any,
  });

  await prisma.issueStatusChange.create({
    data: { issueId: issue.id, toStatus: 'OPEN', assessmentId: assessment.id, automatic: true },
  });

  const report = await prisma.report.create({
    data: {
      assessmentId: assessment.id,
      type: 'TECHNICAL',
      format: 'PDF',
      title: 'Technical report',
      filePath: reportFilePath,
    },
  });

  await prisma.scheduledScan.create({
    data: {
      projectId: PROJECT,
      name: 'Weekly scan',
      frequency: 'WEEKLY',
      timezone: 'UTC',
      weekdays: [1],
      hour: 3,
      minute: 0,
    },
  });

  return { assessment, issue, report };
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
  storageRoot = mkdtempSync(join(tmpdir(), 'api-analyser-project-delete-'));
  process.env.REPORTS_DIR = storageRoot;

  service = new ProjectsService(
    prisma as any,
    {} as any, // CryptoService — unused by remove()/assertExists()
    new EventEmitter2(),
    {} as any, // SettingsService — unused by remove()/assertExists()
    new AuditService(prisma as any, { getBoolean: async () => true } as any, { publish: () => {} } as any),
    new ReportStorageService(),
    fakeQueue(),
    fakeQueue(),
  );
});

afterAll(async () => {
  await teardownTestDatabase();
  rmSync(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
});

afterEach(async () => {
  // `ProjectsService.remove()` fires its audit write without awaiting it (see
  // `AuditService.log`'s own doc comment: logging must never delay the
  // operation it describes). Giving that a moment to land before the next
  // test's `beforeEach` truncates the table avoids a genuine Postgres
  // deadlock between the pending INSERT and the TRUNCATE.
  await new Promise((r) => setTimeout(r, 50));
});

describe('ProjectsService.remove — full cascading delete', () => {
  it('deletes every table that exists only because of the project', async () => {
    const { assessment, issue, report } = await seedFullProject(null);

    await service.remove(PROJECT, OWNER);

    expect(await prisma.project.findUnique({ where: { id: PROJECT } })).toBeNull();
    expect(await prisma.apiSpec.findUnique({ where: { projectId: PROJECT } })).toBeNull();
    expect(await prisma.authConfig.findMany({ where: { apiSpec: { projectId: PROJECT } } })).toHaveLength(0);
    expect(await prisma.endpoint.findMany({ where: { apiSpec: { projectId: PROJECT } } })).toHaveLength(0);
    expect(await prisma.assessment.findUnique({ where: { id: assessment.id } })).toBeNull();
    expect(await prisma.assessmentConfig.findFirst({ where: { assessmentId: assessment.id } })).toBeNull();
    expect(await prisma.assessmentSummary.findFirst({ where: { assessmentId: assessment.id } })).toBeNull();
    expect(await prisma.assessmentLog.findMany({ where: { assessmentId: assessment.id } })).toHaveLength(0);
    expect(await prisma.securityIssue.findUnique({ where: { id: issue.id } })).toBeNull();
    expect(await prisma.findingOccurrence.findMany({ where: { issueId: issue.id } })).toHaveLength(0);
    expect(await prisma.issueStatusChange.findMany({ where: { issueId: issue.id } })).toHaveLength(0);
    expect(await prisma.report.findUnique({ where: { id: report.id } })).toBeNull();
    expect(await prisma.scheduledScan.findMany({ where: { projectId: PROJECT } })).toHaveLength(0);
  });

  it('deletes the on-disk PDF artifact along with its report row', async () => {
    const fileName = 'project-delete-artifact.pdf';
    writeFileSync(join(storageRoot, fileName), Buffer.from('%PDF-1.4 fake'));
    await seedFullProject(fileName);

    expect(existsSync(join(storageRoot, fileName))).toBe(true);

    await service.remove(PROJECT, OWNER);

    expect(existsSync(join(storageRoot, fileName))).toBe(false);
  });

  it('writes a durable audit entry that survives the project it describes', async () => {
    await seedFullProject(null);

    await service.remove(PROJECT, OWNER);

    // `AuditService.log` is fire-and-forget by design (see its own doc
    // comment) — the write can still be in flight when `remove()` resolves —
    // so this polls briefly rather than asserting immediately.
    const entries = await waitForAuditEntries(PROJECT);

    // AuditLog references the project by a plain string column rather than a
    // foreign key precisely so this query still finds the row after the
    // project itself is gone.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].action).toBe('DELETE');
  });

  it('cancels the in-flight scanner job for a running assessment before deleting it', async () => {
    await seedFullProject(null);
    const removeJob = mock(async () => {});
    const scannerQueue = { getJob: mock(async () => ({ remove: removeJob })) } as any;
    const reportsQueue = fakeQueue();

    const scopedService = new ProjectsService(
      prisma as any,
      {} as any,
      new EventEmitter2(),
      {} as any,
      new AuditService(prisma as any, { getBoolean: async () => true } as any, { publish: () => {} } as any),
      new ReportStorageService(),
      scannerQueue,
      reportsQueue,
    );

    await scopedService.remove(PROJECT, OWNER);

    expect(scannerQueue.getJob).toHaveBeenCalledWith('bullmq-job-123');
    expect(removeJob).toHaveBeenCalled();
  });
});

describe('ProjectsService.remove — shared access', () => {
  /**
   * There is no organization boundary in this product: one installation is
   * one company, and any authenticated user may act on any project — the
   * same way an analyst account in Wazuh sees the same data an admin does.
   * `userId` still records who created a project; it no longer gates who may
   * read or delete it.
   */
  it('lets a different user in the same installation delete the project', async () => {
    await seedFullProject(null);

    await service.remove(PROJECT, OTHER);

    expect(await prisma.project.findUnique({ where: { id: PROJECT } })).toBeNull();
  });

  it('404s for a project that does not exist, regardless of who asks', async () => {
    await seedFullProject(null);

    await expect(service.remove('does-not-exist', OWNER)).rejects.toThrow(/not found/i);

    // The real project was untouched by the attempt on the missing id.
    expect(await prisma.project.findUnique({ where: { id: PROJECT } })).not.toBeNull();
  });
});
