import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import { IssueLifecycleService, type ExecutedScope } from './issue-lifecycle.service';
import type { ScanFinding } from '../scanner/types/scanner.types';
import {
  resetTestDatabase,
  seedProjectAndAssessment,
  setupTestDatabase,
  teardownTestDatabase,
} from '../../test/db';

let prisma: PrismaClient;
let service: IssueLifecycleService;

const PROJECT_ID = 'test-project';
const ASSESSMENT_A = 'assessment-a';
const ASSESSMENT_B = 'assessment-b';

const SCOPE: ExecutedScope = {
  successfulPlugins: ['security-headers'],
  failedPlugins: [],
  skippedPlugins: [],
  pluginVersions: { 'security-headers': '1.0.0' },
};

function finding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    title: 'Missing Security Header: Strict-Transport-Security',
    category: 'Security Misconfiguration',
    severity: 'HIGH',
    owaspCategory: 'API8:2023',
    pluginId: 'security-headers',
    ruleId: 'headers.missing-hsts',
    component: 'response-header:strict-transport-security',
    route: '/users/{id}',
    method: 'GET',
    description: 'HSTS header is missing.',
    ...overrides,
  } as ScanFinding;
}

async function persist(
  assessmentId: string,
  findings: ScanFinding[],
  scope: Partial<ExecutedScope> = {},
  detectedAt = new Date('2026-07-19T10:00:00Z'),
) {
  return service.persistScanResults({
    projectId: PROJECT_ID,
    assessmentId,
    findings,
    detectedAt,
    scope: { ...SCOPE, ...scope },
  });
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
  service = new IssueLifecycleService(prisma as any);
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await seedProjectAndAssessment(prisma, { projectId: PROJECT_ID, assessmentId: ASSESSMENT_A });
  await prisma.assessment.create({ data: { id: ASSESSMENT_B, projectId: PROJECT_ID, status: 'RUNNING' } });
});

describe('deduplication across scans', () => {
  it('creates one issue and one occurrence for a first detection', async () => {
    const result = await persist(ASSESSMENT_A, [finding()]);

    expect(result.issuesCreated).toBe(1);
    expect(result.occurrencesCreated).toBe(1);
    expect(await prisma.securityIssue.count()).toBe(1);
    expect(await prisma.findingOccurrence.count()).toBe(1);
  });

  it('two scans of the same problem produce ONE issue with TWO occurrences', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    const second = await persist(ASSESSMENT_B, [finding()]);

    expect(second.issuesCreated).toBe(0);
    expect(second.issuesRecurring).toBe(1);
    expect(await prisma.securityIssue.count()).toBe(1);
    expect(await prisma.findingOccurrence.count()).toBe(2);

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(issue.occurrenceCount).toBe(2);
  });

  it('two different rules of the same plugin on the same endpoint are two issues', async () => {
    // The exact collision the old pluginId+method+path identity produced.
    await persist(ASSESSMENT_A, [
      finding({ ruleId: 'headers.missing-hsts', component: 'response-header:strict-transport-security' }),
      finding({ ruleId: 'headers.missing-cache-control', component: 'response-header:cache-control' }),
    ]);

    expect(await prisma.securityIssue.count()).toBe(2);
  });

  it('preserves firstSeenAt and advances lastSeenAt', async () => {
    const first = new Date('2026-07-01T00:00:00Z');
    const later = new Date('2026-07-19T00:00:00Z');

    await persist(ASSESSMENT_A, [finding()], {}, first);
    await persist(ASSESSMENT_B, [finding()], {}, later);

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(issue.firstSeenAt.toISOString()).toBe(first.toISOString());
    expect(issue.lastSeenAt.toISOString()).toBe(later.toISOString());
  });
});

describe('BullMQ retry idempotency', () => {
  it('deduplicates identical findings within the same scanner result', async () => {
    const duplicate = finding();
    const result = await persist(ASSESSMENT_A, [duplicate, { ...duplicate }]);

    expect(result.occurrencesCreated).toBe(1);
    expect(result.occurrencesSkipped).toBe(0);
    expect(await prisma.findingOccurrence.count()).toBe(1);
  });

  it('re-running the same job creates no duplicate occurrence', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    const retry = await persist(ASSESSMENT_A, [finding()]);

    expect(retry.occurrencesCreated).toBe(0);
    expect(retry.occurrencesSkipped).toBe(1);
    expect(await prisma.findingOccurrence.count()).toBe(1);
  });

  it('re-running the same job does not double-count occurrenceCount', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    await persist(ASSESSMENT_A, [finding()]);
    await persist(ASSESSMENT_A, [finding()]);

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(issue.occurrenceCount).toBe(1);
  });

  it('re-running the same job creates no duplicate issue', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    await persist(ASSESSMENT_A, [finding()]);
    expect(await prisma.securityIssue.count()).toBe(1);
  });

  it('re-running does not append duplicate status history', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    const before = await prisma.issueStatusChange.count();
    await persist(ASSESSMENT_A, [finding()]);
    expect(await prisma.issueStatusChange.count()).toBe(before);
  });
});

describe('lifecycle transitions', () => {
  async function seedIssueWithStatus(status: any, extra: Record<string, unknown> = {}) {
    await persist(ASSESSMENT_A, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();
    await prisma.securityIssue.update({
      where: { id: issue.id },
      data: { status, ...extra },
    });
    await prisma.issueStatusChange.deleteMany();
    return issue;
  }

  it('reopens a RESOLVED issue when it is detected again', async () => {
    await seedIssueWithStatus('RESOLVED', { resolvedAt: new Date('2026-07-10T00:00:00Z') });

    const result = await persist(ASSESSMENT_B, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();

    expect(result.issuesReopened).toBe(1);
    expect(issue.status).toBe('OPEN');
    expect(issue.reopenCount).toBe(1);
    expect(issue.reopenedAt).not.toBeNull();
    expect(issue.resolvedAt).toBeNull();

    const change = await prisma.issueStatusChange.findFirstOrThrow();
    expect(change.fromStatus).toBe('RESOLVED');
    expect(change.toStatus).toBe('OPEN');
    expect(change.assessmentId).toBe(ASSESSMENT_B);
    expect(change.automatic).toBe(true);
  });

  it('does NOT reopen a FALSE_POSITIVE, but still records the occurrence', async () => {
    await seedIssueWithStatus('FALSE_POSITIVE');

    await persist(ASSESSMENT_B, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();

    expect(issue.status).toBe('FALSE_POSITIVE');
    expect(await prisma.issueStatusChange.count()).toBe(0);
    // Evidence that the detector fired again is still preserved.
    expect(await prisma.findingOccurrence.count()).toBe(2);
  });

  it('does NOT reopen an ACCEPTED_RISK whose acceptance is still valid', async () => {
    await seedIssueWithStatus('ACCEPTED_RISK', {
      acceptedRiskUntil: new Date('2027-01-01T00:00:00Z'),
    });

    await persist(ASSESSMENT_B, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();

    expect(issue.status).toBe('ACCEPTED_RISK');
    expect(await prisma.issueStatusChange.count()).toBe(0);
  });

  it('reopens an ACCEPTED_RISK whose acceptance has expired', async () => {
    await seedIssueWithStatus('ACCEPTED_RISK', {
      acceptedRiskUntil: new Date('2026-01-01T00:00:00Z'),
    });

    await persist(ASSESSMENT_B, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();

    expect(issue.status).toBe('OPEN');
    const change = await prisma.issueStatusChange.findFirstOrThrow();
    expect(change.reason).toContain('expired');
  });

  it('does not record a redundant transition for an already OPEN issue', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    await prisma.issueStatusChange.deleteMany();

    await persist(ASSESSMENT_B, [finding()]);
    expect(await prisma.issueStatusChange.count()).toBe(0);
  });

  it('keeps an ACKNOWLEDGED issue acknowledged', async () => {
    await seedIssueWithStatus('ACKNOWLEDGED');
    await persist(ASSESSMENT_B, [finding()]);

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(issue.status).toBe('ACKNOWLEDGED');
  });
});

describe('reconciliation — absence is not a fix', () => {
  it('resolves an issue when its check ran successfully and did not report it', async () => {
    await persist(ASSESSMENT_A, [finding()]);

    const result = await persist(ASSESSMENT_B, [], {
      successfulPlugins: ['security-headers'],
    });

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(result.issuesResolved).toBe(1);
    expect(issue.status).toBe('RESOLVED');
    expect(issue.resolvedAt).not.toBeNull();
  });

  it('does NOT resolve when the check was never run', async () => {
    await persist(ASSESSMENT_A, [finding()]);

    const result = await persist(ASSESSMENT_B, [], {
      successfulPlugins: ['cors'],
      skippedPlugins: ['security-headers'],
      pluginVersions: { cors: '1.0.0' },
    });

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(result.issuesResolved).toBe(0);
    expect(issue.status).toBe('OPEN');
  });

  it('does NOT resolve when the check FAILED', async () => {
    await persist(ASSESSMENT_A, [finding()]);

    const result = await persist(ASSESSMENT_B, [], {
      successfulPlugins: [],
      failedPlugins: ['security-headers'],
    });

    const issue = await prisma.securityIssue.findFirstOrThrow();
    expect(result.issuesResolved).toBe(0);
    expect(issue.status).toBe('OPEN');
    expect(result.issuesNotTested).toBeGreaterThan(0);
  });

  it('does NOT resolve a FALSE_POSITIVE or ACCEPTED_RISK by reconciliation', async () => {
    await persist(ASSESSMENT_A, [
      finding({ ruleId: 'headers.missing-hsts', component: 'a' }),
      finding({ ruleId: 'headers.missing-cache-control', component: 'b' }),
    ]);
    const [first, second] = await prisma.securityIssue.findMany({ orderBy: { ruleId: 'asc' } });
    await prisma.securityIssue.update({ where: { id: first.id }, data: { status: 'FALSE_POSITIVE' } });
    await prisma.securityIssue.update({ where: { id: second.id }, data: { status: 'ACCEPTED_RISK' } });

    await persist(ASSESSMENT_B, [], { successfulPlugins: ['security-headers'] });

    const after = await prisma.securityIssue.findMany({ orderBy: { ruleId: 'asc' } });
    expect(after[0].status).toBe('FALSE_POSITIVE');
    expect(after[1].status).toBe('ACCEPTED_RISK');
  });
});

describe('triage survives scan deletion', () => {
  it('deleting an assessment removes its occurrences but keeps the issue and its history', async () => {
    await persist(ASSESSMENT_A, [finding()]);
    const issue = await prisma.securityIssue.findFirstOrThrow();
    await prisma.securityIssue.update({
      where: { id: issue.id },
      data: { status: 'ACKNOWLEDGED', notes: 'Reviewed by the security team.' },
    });
    await prisma.issueStatusChange.create({
      data: { issueId: issue.id, fromStatus: 'OPEN', toStatus: 'ACKNOWLEDGED', assessmentId: ASSESSMENT_A },
    });

    await prisma.assessment.delete({ where: { id: ASSESSMENT_A } });

    const survivor = await prisma.securityIssue.findUnique({ where: { id: issue.id } });
    expect(survivor).not.toBeNull();
    expect(survivor!.status).toBe('ACKNOWLEDGED');
    expect(survivor!.notes).toBe('Reviewed by the security team.');

    // The history row survives with its assessment link cleared, not deleted.
    const history = await prisma.issueStatusChange.findMany({ where: { issueId: issue.id } });
    expect(history).toHaveLength(1);
    expect(history[0].assessmentId).toBeNull();

    // Occurrences belong to the scan and go with it.
    expect(await prisma.findingOccurrence.count()).toBe(0);
  });
});

describe('evidence redaction', () => {
  it('never persists credentials in occurrence evidence', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.realsecrettoken.signature';

    await persist(ASSESSMENT_A, [
      finding({
        httpRequest: `GET /users/1 HTTP/1.1\nAuthorization: Bearer ${token}`,
        httpResponse: 'HTTP/1.1 200\nSet-Cookie: session=abc123secret',
        evidence: { password: 'hunter2', safe: 'kept' } as any,
      }),
    ]);

    const occurrence = await prisma.findingOccurrence.findFirstOrThrow();
    const serialised = JSON.stringify(occurrence);

    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain('abc123secret');
    expect(serialised).not.toContain('hunter2');
    expect(occurrence.httpRequest).toContain('[REDACTED]');
    expect(serialised).toContain('kept');
  });
});

describe('findings without identity', () => {
  it('discards a finding with no ruleId rather than persisting an orphan', async () => {
    const result = await persist(ASSESSMENT_A, [finding({ ruleId: '' } as any)]);

    expect(result.occurrencesCreated).toBe(0);
    expect(await prisma.securityIssue.count()).toBe(0);
  });
});
