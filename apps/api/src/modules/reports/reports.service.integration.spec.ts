import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * The behaviours the Reports screens depend on, against a real database.
 *
 * These exist because the bug they guard against was invisible to a unit test:
 * downloading a report used to call the generation endpoint, which inserted a
 * second `Report` row for the same scan, type and format. Only a real database
 * — with the unique index that now makes that impossible — can prove it stays
 * fixed.
 *
 * Text formats are used throughout so the suite does not depend on a Chromium
 * install. `generatePdfRecord` covers the PDF row semantics separately; PDF
 * *rendering* degrades gracefully and is asserted as such.
 */

let prisma: PrismaClient;
let service: ReportsService;
let storageRoot: string;

const USER_A = 'user-a';
const USER_B = 'user-b';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';
const SCAN_A = 'scan-a';
const SCAN_B = 'scan-b';

async function createUser(id: string) {
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id } });
}

async function createProject(id: string, userId: string) {
  await prisma.project.create({
    data: { id, name: `Project ${id}`, baseUrl: `https://${id}.test.local`, userId },
  });
}

async function createScan(
  id: string,
  projectId: string,
  options: { completedAt?: Date; securityScore?: number | null } = {},
) {
  await prisma.assessment.create({
    data: {
      id,
      projectId,
      status: 'COMPLETED',
      completedAt: options.completedAt ?? new Date(),
      summary: {
        create: {
          securityScore: options.securityScore === undefined ? 70 : options.securityScore,
        },
      },
    },
  });
}

/** One occurrence of the given severity, attached to a scan. */
async function addOccurrence(
  projectId: string,
  assessmentId: string,
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
  key: string,
) {
  const issue = await prisma.securityIssue.create({
    data: {
      projectId,
      fingerprint: `${assessmentId}-${key}`,
      pluginId: 'test-plugin',
      ruleId: key,
      method: 'GET',
      normalizedRoute: '/users/{id}',
      component: 'endpoint',
      title: `${severity} ${key}`,
      description: `${severity} ${key} description`,
      severity,
      owaspCategory: 'API8:2023',
      status: 'OPEN',
    } as any,
  });

  await prisma.findingOccurrence.create({
    data: {
      assessmentId,
      issueId: issue.id,
      occurrenceKey: `${assessmentId}-${key}`,
      methodSnapshot: 'GET',
      pathSnapshot: '/users/{id}',
      pluginIdSnapshot: 'test-plugin',
      pluginVersionSnapshot: '1.0.0',
      ruleIdSnapshot: key,
      severitySnapshot: severity,
      owaspSnapshot: 'API8:2023',
      titleSnapshot: `${severity} ${key}`,
      descriptionSnapshot: `${severity} ${key} description`,
      location: 'endpoint',
      detectedAt: new Date(),
    } as any,
  });
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
  storageRoot = mkdtempSync(join(tmpdir(), 'iasa-reports-'));
  process.env.REPORTS_DIR = storageRoot;

  const generator = new ReportGeneratorService(prisma as any);
  const storage = new ReportStorageService();
  service = new ReportsService(prisma as any, generator, storage);
});

afterAll(async () => {
  await teardownTestDatabase();
  rmSync(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await createUser(USER_A);
  await createUser(USER_B);
  await createProject(PROJECT_A, USER_A);
  await createProject(PROJECT_B, USER_B);
});

// ── Generate ────────────────────────────────────────────────────────────────

describe('generate', () => {
  it('creates exactly one report row and persists a downloadable artifact', async () => {
    await createScan(SCAN_A, PROJECT_A);

    const { report, created } = await service.generate(SCAN_A, USER_A, {
      type: 'TECHNICAL',
      format: 'HTML',
    });

    expect(created).toBe(true);
    expect(report.isDownloadable).toBe(true);
    expect(report.fileName).toBe(`iasa-project-${PROJECT_A}-technical-${new Date().toISOString().split('T')[0]}.html`);
    expect(report.fileSize).toBeGreaterThan(0);
    expect(report.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
  });

  it('returns the existing report instead of creating a second one', async () => {
    await createScan(SCAN_A, PROJECT_A);

    const first = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });
    const second = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.report.id).toBe(first.report.id);
    expect(second.report.generatedAt).toEqual(first.report.generatedAt);
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
  });

  it('collapses a double click — concurrent generations produce one artifact', async () => {
    await createScan(SCAN_A, PROJECT_A);

    const results = await Promise.all([
      service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' }),
      service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' }),
      service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' }),
    ]);

    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
    const ids = new Set(results.map((result) => result.report.id));
    expect(ids.size).toBe(1);
  });

  it('generates only the format asked for, leaving the others missing', async () => {
    await createScan(SCAN_A, PROJECT_A);

    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'SARIF' });

    const rows = await prisma.report.findMany({ where: { assessmentId: SCAN_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe('SARIF');

    const availability = await service.formatAvailability(SCAN_A, 'TECHNICAL');
    expect(availability.find((entry) => entry.format === 'SARIF')?.status).toBe('AVAILABLE');
    expect(availability.find((entry) => entry.format === 'HTML')?.status).toBe('MISSING');
    expect(availability.find((entry) => entry.format === 'PDF')?.status).toBe('MISSING');
  });

  it('stamps the generator version onto a legacy row it fills in place', async () => {
    await createScan(SCAN_A, PROJECT_A);
    // A pre-artifact record: real row, nothing behind it.
    const legacy = await prisma.report.create({
      data: { assessmentId: SCAN_A, type: 'TECHNICAL', format: 'HTML', title: 'Legacy' } as any,
    });

    const { report, created } = await service.generate(SCAN_A, USER_A, {
      type: 'TECHNICAL',
      format: 'HTML',
    });

    // Filled in place: same id, no new row, and now attributable to a generator.
    expect(created).toBe(false);
    expect(report.id).toBe(legacy.id);
    expect(report.generatorVersion).toBe('1.0.0');
    expect(report.isDownloadable).toBe(true);
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
  });

  it('records the generator version on a freshly created report', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });
    expect(report.generatorVersion).toBe('1.0.0');
  });

  it('adds a format to an existing bundle without touching the first one', async () => {
    await createScan(SCAN_A, PROJECT_A);

    const html = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });

    const rows = await prisma.report.findMany({ where: { assessmentId: SCAN_A } });
    expect(rows).toHaveLength(2);
    const stillThere = rows.find((row) => row.id === html.report.id)!;
    expect(stillThere.generatedAt).toEqual(html.report.generatedAt as Date);
  });

  it('mints an explicit new version only when regeneration is requested', async () => {
    await createScan(SCAN_A, PROJECT_A);

    const first = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    const regenerated = await service.generate(SCAN_A, USER_A, {
      type: 'TECHNICAL',
      format: 'HTML',
      regenerate: true,
    });

    expect(regenerated.created).toBe(true);
    expect(regenerated.report.id).not.toBe(first.report.id);
    expect(regenerated.report.version).toBe(2);
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(2);
  });

  it('refuses to generate against another user’s assessment', async () => {
    await createScan(SCAN_B, PROJECT_B);
    await expect(
      service.generate(SCAN_B, USER_A, { type: 'TECHNICAL', format: 'HTML' }),
    ).rejects.toThrow();
    expect(await prisma.report.count()).toBe(0);
  });
});

// ── Download ────────────────────────────────────────────────────────────────

describe('download', () => {
  it('never creates a row and never moves generatedAt', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    const before = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });

    await service.resolveArtifact(report.id, USER_A);
    await service.resolveArtifact(report.id, USER_A);
    await service.resolveArtifact(report.id, USER_A);

    const after = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
    expect(after.generatedAt).toEqual(before.generatedAt);
    expect(after.version).toBe(before.version);
  });

  it('serves the artifact with the stored name and the format’s MIME type', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });

    const artifact = await service.resolveArtifact(report.id, USER_A);

    expect(artifact.contentType).toBe('application/json; charset=utf-8');
    expect(artifact.fileName).toBe(report.fileName);
    expect(artifact.fileName.endsWith('.json')).toBe(true);
    expect(() => JSON.parse(artifact.bytes.toString('utf8'))).not.toThrow();
  });

  it('replays the frozen snapshot — later re-triage cannot alter an issued report', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await addOccurrence(PROJECT_A, SCAN_A, 'CRITICAL', 'original-finding');

    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'MARKDOWN' });
    const issued = (await service.resolveArtifact(report.id, USER_A)).bytes.toString('utf8');
    expect(issued).toContain('CRITICAL original-finding');

    // The scan gains a finding after the report was issued.
    await addOccurrence(PROJECT_A, SCAN_A, 'HIGH', 'added-later');

    const redownloaded = (await service.resolveArtifact(report.id, USER_A)).bytes.toString('utf8');
    expect(redownloaded).toBe(issued);
    expect(redownloaded).not.toContain('added-later');
  });

  it('refuses to serve another user’s report', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    await expect(service.resolveArtifact(report.id, USER_B)).rejects.toThrow('Report not found');
  });

  it('rejects an unknown report id', async () => {
    await expect(service.resolveArtifact('does-not-exist', USER_A)).rejects.toThrow('Report not found');
  });

  it('fails loudly rather than silently regenerating when no artifact was ever stored', async () => {
    await createScan(SCAN_A, PROJECT_A);
    // A pre-fix row: recorded, but with nothing behind it.
    const legacy = await prisma.report.create({
      data: {
        assessmentId: SCAN_A,
        type: 'TECHNICAL',
        format: 'HTML',
        title: 'Legacy report',
      } as any,
    });

    await expect(service.resolveArtifact(legacy.id, USER_A)).rejects.toThrow(/no stored artifact/i);
    expect(await prisma.report.count({ where: { assessmentId: SCAN_A } })).toBe(1);
  });
});

// ── Listing and duplicates ──────────────────────────────────────────────────

describe('findAll', () => {
  it('shows one row per format, not one per download', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });

    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.resolveArtifact(report.id, USER_A);
    await service.resolveArtifact(report.id, USER_A);

    const listed = await service.findAll(USER_A);
    expect(listed).toHaveLength(2);
    expect(listed.map((row) => row.format).sort()).toEqual(['HTML', 'JSON']);
  });

  it('hides superseded versions by default and reveals them on request', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML', regenerate: true });

    expect(await service.findAll(USER_A)).toHaveLength(1);
    expect((await service.findAll(USER_A))[0].version).toBe(2);
    expect(await service.findAll(USER_A, { includeHistory: true })).toHaveLength(2);
  });

  it('never leaks another user’s reports', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await createScan(SCAN_B, PROJECT_B);
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.generate(SCAN_B, USER_B, { type: 'TECHNICAL', format: 'HTML' });

    const mine = await service.findAll(USER_A);
    expect(mine).toHaveLength(1);
    expect(mine[0].assessmentId).toBe(SCAN_A);
  });

  it('does not ship the whole document body with every list row', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    const listed = await service.findAll(USER_A);
    expect('sourceSnapshot' in listed[0]).toBe(false);
  });
});

// ── Stats ───────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('counts each finding once regardless of how many formats the scan was exported to', async () => {
    await createScan(SCAN_A, PROJECT_A);
    await addOccurrence(PROJECT_A, SCAN_A, 'CRITICAL', 'c1');
    await addOccurrence(PROJECT_A, SCAN_A, 'HIGH', 'h1');
    await addOccurrence(PROJECT_A, SCAN_A, 'LOW', 'l1');

    for (const format of ['HTML', 'JSON', 'MARKDOWN', 'SARIF'] as const) {
      await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format });
    }

    const stats = await service.getStats(USER_A);

    expect(stats.activeReportArtifacts).toBe(4); // four artifacts …
    expect(stats.distinctAssessmentsWithReports).toBe(1); // … of one scan
    expect(stats.criticalFindingsIncluded).toBe(1);
    expect(stats.highFindingsIncluded).toBe(1);
    expect(stats.lowFindingsIncluded).toBe(1);
    expect(stats.totalFindingsIncluded).toBe(3);
    expect(stats.criticalHighFindingsIncluded).toBe(2);
  });

  it('scopes findings and score to scans that actually produced a report', async () => {
    await createScan(SCAN_A, PROJECT_A, { securityScore: 90 });
    await addOccurrence(PROJECT_A, SCAN_A, 'CRITICAL', 'reported');

    // A completed scan with findings but no report must not leak into the numbers.
    await createScan('scan-unreported', PROJECT_A, { securityScore: 10 });
    await addOccurrence(PROJECT_A, 'scan-unreported', 'CRITICAL', 'unreported');

    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    const stats = await service.getStats(USER_A);
    expect(stats.criticalFindingsIncluded).toBe(1);
    expect(stats.averageAssessmentScore).toBe(90);
    expect(stats.distinctAssessmentsWithReports).toBe(1);
    expect(stats.totalCompletedAssessments).toBe(2);
    expect(stats.distinctProjectsCovered).toBe(1);
  });

  it('builds a continuous 30-day trend that does not multiply a scan by its formats', async () => {
    const today = new Date();
    await createScan(SCAN_A, PROJECT_A, { completedAt: today });
    await addOccurrence(PROJECT_A, SCAN_A, 'CRITICAL', 'c1');
    await addOccurrence(PROJECT_A, SCAN_A, 'CRITICAL', 'c2');

    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'JSON' });

    const stats = await service.getStats(USER_A);
    expect(stats.vulnerabilityTrend).toHaveLength(30);

    const day = stats.vulnerabilityTrend.find((point) => point.date === today.toISOString().split('T')[0])!;
    expect(day.critical).toBe(2);
    expect(day.scans).toBe(1);
  });

  it('reports no average score rather than a perfect one when nothing was scored', async () => {
    await createScan(SCAN_A, PROJECT_A, { securityScore: null });
    await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    const stats = await service.getStats(USER_A);
    expect(stats.averageAssessmentScore).toBeNull();
    expect(stats.scoredAssessmentsInAverage).toBe(0);
  });
});

// ── Deletion ────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('deletes the row and only its own stored artifact', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    // A bystander file in the same storage root must survive.
    const bystander = join(storageRoot, 'unrelated.pdf');
    writeFileSync(bystander, 'keep me');

    await service.remove(report.id, USER_A);

    expect(await prisma.report.count({ where: { id: report.id } })).toBe(0);
    expect(existsSync(bystander)).toBe(true);
  });

  it('refuses to delete another user’s report', async () => {
    await createScan(SCAN_A, PROJECT_A);
    const { report } = await service.generate(SCAN_A, USER_A, { type: 'TECHNICAL', format: 'HTML' });

    await expect(service.remove(report.id, USER_B)).rejects.toThrow('Report not found');
    expect(await prisma.report.count({ where: { id: report.id } })).toBe(1);
  });
});
