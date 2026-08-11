import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { testPluginRegistry } from '../../test/plugin-registry';
import { ReportStorageService } from './report-storage.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * What a download does when it cannot produce the artifact.
 *
 * The one thing it must never do is fall back to generating a fresh report:
 * that is exactly how a download used to create a duplicate. Each failure mode
 * below asserts both the message the user sees and that the report table is
 * untouched.
 */

let prisma: PrismaClient;
let storageRoot: string;

const USER = 'err-user';
const PROJECT = 'err-project';
const SCAN = 'err-scan';

/** A generator whose PDF renderer always fails, as on a host with no Chromium. */
class NoChromiumGenerator extends ReportGeneratorService {
  async renderPdfFromHtml(): Promise<Buffer> {
    throw new Error('PDF generation requires Chromium. Set CHROMIUM_EXECUTABLE_PATH.');
  }
}

function serviceWith(generator: ReportGeneratorService) {
  return new ReportsService(prisma as any, generator, new ReportStorageService());
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
  storageRoot = mkdtempSync(join(tmpdir(), 'api-analyser-report-errors-'));
  process.env.REPORTS_DIR = storageRoot;
});

afterAll(async () => {
  await teardownTestDatabase();
  rmSync(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, name: USER } });
  await prisma.project.create({
    data: { id: PROJECT, name: 'Errors', baseUrl: 'https://errors.test.local', userId: USER },
  });
  await prisma.assessment.create({
    data: { id: SCAN, projectId: PROJECT, status: 'COMPLETED', completedAt: new Date(), summary: { create: {} } },
  });
});

describe('no stored artifact', () => {
  it('refuses with an actionable message and creates nothing', async () => {
    const service = serviceWith(new ReportGeneratorService(prisma as any, testPluginRegistry()));
    const legacy = await prisma.report.create({
      data: { assessmentId: SCAN, type: 'TECHNICAL', format: 'PDF', title: 'Legacy' } as any,
    });

    await expect(service.resolveArtifact(legacy.id, USER)).rejects.toThrow(
      /no stored artifact.*[Rr]egenerate/s,
    );
    expect(await prisma.report.count()).toBe(1);
  });
});

describe('PDF renderer unavailable', () => {
  it('reports the missing renderer instead of failing opaquely', async () => {
    const service = serviceWith(new NoChromiumGenerator(prisma as any, testPluginRegistry()));
    // Generation itself survives: the HTML snapshot is kept even though the
    // PDF could not be printed.
    const { report } = await service.generate(SCAN, USER, { type: 'TECHNICAL', format: 'PDF' });
    expect(report.isDownloadable).toBe(true);

    await expect(service.resolveArtifact(report.id, USER)).rejects.toThrow(
      /no PDF renderer is available/i,
    );
  });

  it('names a remedy and never leaks a server path', async () => {
    const service = serviceWith(new NoChromiumGenerator(prisma as any, testPluginRegistry()));
    const { report } = await service.generate(SCAN, USER, { type: 'TECHNICAL', format: 'PDF' });

    const message = await service.resolveArtifact(report.id, USER).then(
      () => '',
      (error) => String(error.message),
    );

    expect(message).toContain('CHROMIUM_EXECUTABLE_PATH');
    expect(message).toContain('another format');
    expect(message).not.toContain(storageRoot);
    expect(message).not.toMatch(/[A-Za-z]:\\|\/home\/|\/usr\/|node_modules/);
  });

  it('does NOT generate a replacement report as a fallback', async () => {
    const service = serviceWith(new NoChromiumGenerator(prisma as any, testPluginRegistry()));
    const { report } = await service.generate(SCAN, USER, { type: 'TECHNICAL', format: 'PDF' });

    const before = await prisma.report.findMany();
    await service.resolveArtifact(report.id, USER).catch(() => null);
    const after = await prisma.report.findMany();

    expect(after).toHaveLength(before.length);
    expect(after[0].generatedAt).toEqual(before[0].generatedAt);
    expect(after[0].version).toBe(before[0].version);
  });

  it('still serves the text formats of the same scan', async () => {
    const service = serviceWith(new NoChromiumGenerator(prisma as any, testPluginRegistry()));
    const { report } = await service.generate(SCAN, USER, { type: 'TECHNICAL', format: 'JSON' });

    const artifact = await service.resolveArtifact(report.id, USER);
    expect(artifact.contentType).toBe('application/json; charset=utf-8');
    expect(artifact.bytes.length).toBeGreaterThan(0);
  });
});
