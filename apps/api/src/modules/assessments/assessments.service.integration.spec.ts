import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import { AssessmentsService } from './assessments.service';
import { IssueLifecycleService } from '../issues/issue-lifecycle.service';
import type { ScanFinding } from '../scanner/types/scanner.types';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * Verifies the two behaviours the Assessments screens depend on, against a real
 * database:
 *
 *   • Critical / High / Total come from the scan's real `FindingOccurrence`
 *     rows, not the persisted summary counters (which stay zero here on
 *     purpose, mirroring demo/old data).
 *   • The project-detail list paginates server-side, newest first, scoped to
 *     the project, without duplicates across pages.
 */

let prisma: PrismaClient;
let service: AssessmentsService;
let lifecycle: IssueLifecycleService;

const USER_A = 'user-a';
const USER_B = 'user-b';
const PROJECT_A = 'project-a';
const PROJECT_A2 = 'project-a2';
const PROJECT_B = 'project-b';

function finding(severity: ScanFinding['severity'], ruleId: string): ScanFinding {
  return {
    title: `${severity} ${ruleId}`,
    category: 'Security Misconfiguration',
    severity,
    owaspCategory: 'API8:2023',
    pluginId: 'test-plugin',
    ruleId, // distinct ruleId ⇒ distinct fingerprint ⇒ distinct occurrence
    component: 'endpoint',
    route: '/users/{id}',
    method: 'GET',
    description: 'test finding',
  } as ScanFinding;
}

async function createUser(id: string) {
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id } });
}

async function createProject(id: string, userId: string) {
  await prisma.project.create({ data: { id, name: id, baseUrl: `https://${id}.test.local`, userId } });
}

/** COMPLETED assessment with an EMPTY summary — counts must not come from it. */
async function createAssessment(id: string, projectId: string, createdAt: Date) {
  await prisma.assessment.create({
    data: { id, projectId, status: 'COMPLETED', createdAt, summary: { create: {} } },
  });
}

async function addFindings(projectId: string, assessmentId: string, findings: ScanFinding[]) {
  await lifecycle.persistScanResults({
    projectId,
    assessmentId,
    findings,
    detectedAt: new Date('2026-07-19T10:00:00Z'),
    scope: {
      successfulPlugins: ['test-plugin'],
      failedPlugins: [],
      skippedPlugins: [],
      pluginVersions: { 'test-plugin': '1.0.0' },
    },
  });
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
  // Only prisma is exercised by findAll / findByProjectPaginated; the other
  // collaborators are stubbed. The constructor registers an event listener, so
  // the event emitter must expose `.on`.
  service = new AssessmentsService(
    prisma as any,
    {} as any,
    { on() {} } as any,
    {} as any,
    {} as any,
  );
  lifecycle = new IssueLifecycleService(prisma as any);
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
});

describe('findAll — finding counts derived from real occurrences', () => {
  it('returns 0 for Critical, High and Total when the assessment has no findings', async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    await createAssessment('a-empty', PROJECT_A, new Date('2026-01-01'));

    const [row] = await service.findAll(USER_A);
    expect(row.id).toBe('a-empty');
    expect(row.findingCounts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: 0,
    });
  });

  it('counts each severity and includes every severity in Total', async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    await createAssessment('a1', PROJECT_A, new Date('2026-01-01'));
    await addFindings(PROJECT_A, 'a1', [
      finding('CRITICAL', 'r1'),
      finding('CRITICAL', 'r2'),
      finding('HIGH', 'r3'),
      finding('MEDIUM', 'r4'),
      finding('MEDIUM', 'r5'),
      finding('MEDIUM', 'r6'),
      finding('LOW', 'r7'),
      finding('INFO', 'r8'),
    ]);

    const [row] = await service.findAll(USER_A);
    expect(row.findingCounts).toEqual({
      critical: 2,
      high: 1,
      medium: 3,
      low: 1,
      info: 1,
      total: 8, // 2 + 1 + 3 + 1 + 1 — all severities
    });
  });

  it('reads from occurrences, NOT from the persisted summary counters', async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    await createAssessment('a1', PROJECT_A, new Date('2026-01-01'));
    await addFindings(PROJECT_A, 'a1', [finding('CRITICAL', 'r1'), finding('HIGH', 'r2')]);

    const [row] = await service.findAll(USER_A);
    // The summary row exists but was never aggregated (defaults to 0), exactly
    // like demo/old data — yet the counts are correct.
    expect(row.summary?.criticalCount).toBe(0);
    expect(row.summary?.totalFindings).toBe(0);
    expect(row.findingCounts).toMatchObject({ critical: 1, high: 1, total: 2 });
  });

  it('attaches counts to the correct assessment', async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    await createAssessment('a1', PROJECT_A, new Date('2026-01-01'));
    await createAssessment('a2', PROJECT_A, new Date('2026-01-02'));
    await addFindings(PROJECT_A, 'a1', [finding('CRITICAL', 'rc')]);
    await addFindings(PROJECT_A, 'a2', [finding('HIGH', 'rh')]);

    const rows = await service.findAll(USER_A);
    const a1 = rows.find((r) => r.id === 'a1')!;
    const a2 = rows.find((r) => r.id === 'a2')!;
    expect(a1.findingCounts).toMatchObject({ critical: 1, high: 0, total: 1 });
    expect(a2.findingCounts).toMatchObject({ critical: 0, high: 1, total: 1 });
  });

  it('uses a single grouped query — no N+1 across assessments', async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    for (let i = 0; i < 6; i += 1) {
      await createAssessment(`a-${i}`, PROJECT_A, new Date(2026, 0, 1 + i));
    }
    await addFindings(PROJECT_A, 'a-0', [finding('CRITICAL', 'r1')]);

    const original = prisma.findingOccurrence.groupBy;
    let calls = 0;
    (prisma.findingOccurrence as any).groupBy = function (...args: any[]) {
      calls += 1;
      return (original as any).apply(prisma.findingOccurrence, args);
    };
    try {
      await service.findAll(USER_A);
    } finally {
      (prisma.findingOccurrence as any).groupBy = original;
    }
    expect(calls).toBe(1);
  });
});

describe('project isolation', () => {
  it("does not surface one project's assessments under another project or user", async () => {
    await createUser(USER_A);
    await createUser(USER_B);
    await createProject(PROJECT_A, USER_A);
    await createProject(PROJECT_A2, USER_A);
    await createProject(PROJECT_B, USER_B);
    await createAssessment('a-in-A', PROJECT_A, new Date('2026-01-01'));
    await createAssessment('a-in-A2', PROJECT_A2, new Date('2026-01-02'));
    await createAssessment('b-in-B', PROJECT_B, new Date('2026-01-03'));

    const allForA = await service.findAll(USER_A);
    expect(allForA.map((r) => r.id).sort()).toEqual(['a-in-A', 'a-in-A2']);

    const onlyProjectA = await service.findAll(USER_A, PROJECT_A);
    expect(onlyProjectA.map((r) => r.id)).toEqual(['a-in-A']);

    const forB = await service.findAll(USER_B);
    expect(forB.map((r) => r.id)).toEqual(['b-in-B']);
  });
});

describe('findByProjectPaginated', () => {
  beforeEach(async () => {
    await createUser(USER_A);
    await createProject(PROJECT_A, USER_A);
    await createProject(PROJECT_B, USER_A);
    // 12 assessments, a-00 (oldest) … a-11 (newest).
    for (let i = 0; i < 12; i += 1) {
      await createAssessment(`a-${String(i).padStart(2, '0')}`, PROJECT_A, new Date(2026, 0, 1 + i));
    }
    // A different project's scan must never appear in project A's pages.
    await createAssessment('other', PROJECT_B, new Date(2026, 5, 1));
  });

  it('first page returns the 5 most recent, newest first', async () => {
    const page = await service.findByProjectPaginated(USER_A, PROJECT_A, 1, 5);
    expect(page.total).toBe(12);
    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(1);
    expect(page.data.map((r) => r.id)).toEqual(['a-11', 'a-10', 'a-09', 'a-08', 'a-07']);
  });

  it('second page returns the next records with no duplicates', async () => {
    const p1 = await service.findByProjectPaginated(USER_A, PROJECT_A, 1, 5);
    const p2 = await service.findByProjectPaginated(USER_A, PROJECT_A, 2, 5);
    expect(p2.data.map((r) => r.id)).toEqual(['a-06', 'a-05', 'a-04', 'a-03', 'a-02']);
    const overlap = p1.data.map((r) => r.id).filter((id) => p2.data.some((r) => r.id === id));
    expect(overlap).toEqual([]);
  });

  it('last page works with fewer than a full page', async () => {
    const p3 = await service.findByProjectPaginated(USER_A, PROJECT_A, 3, 5);
    expect(p3.data.map((r) => r.id)).toEqual(['a-01', 'a-00']);
    expect(p3.data.length).toBe(2);
  });

  it('exposes bounds that drive the disabled Previous/Next controls', async () => {
    const first = await service.findByProjectPaginated(USER_A, PROJECT_A, 1, 5);
    const last = await service.findByProjectPaginated(USER_A, PROJECT_A, 3, 5);
    // Previous disabled on the first page:
    expect(first.page <= 1).toBe(true);
    // Next disabled on the last page:
    expect(last.page >= last.totalPages).toBe(true);
  });

  it('is scoped to the project', async () => {
    const page = await service.findByProjectPaginated(USER_A, PROJECT_A, 1, 5);
    expect(page.total).toBe(12);
    expect(page.data.some((r) => r.id === 'other')).toBe(false);
  });

  it('attaches occurrence-derived counts to paginated rows', async () => {
    await addFindings(PROJECT_A, 'a-11', [finding('CRITICAL', 'r1'), finding('HIGH', 'r2')]);
    const page = await service.findByProjectPaginated(USER_A, PROJECT_A, 1, 5);
    expect(page.data[0].id).toBe('a-11');
    expect(page.data[0].findingCounts).toMatchObject({ critical: 1, high: 1, total: 2 });
  });

  it('returns an empty page for a project the user does not own', async () => {
    await createUser(USER_B);
    const page = await service.findByProjectPaginated(USER_B, PROJECT_A, 1, 5);
    expect(page.total).toBe(0);
    expect(page.data).toEqual([]);
    expect(page.totalPages).toBe(1);
  });
});
