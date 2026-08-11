import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Integration-test database harness.
 *
 * The issue lifecycle is defined by database constraints — the unique index on
 * `(assessmentId, occurrenceKey)` is what makes a BullMQ retry safe — so it
 * cannot be verified against a mock. These tests run against a real PostgreSQL
 * database, separate from the development one, created from the same baseline
 * migration the application uses.
 */

const TEST_DATABASE_NAME = 'api_analyser_test';

/** Rewrites the configured DATABASE_URL to point at the test database. */
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL must be set to run integration tests.');
  return base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DATABASE_NAME}$1`);
}

let client: PrismaClient | null = null;

/**
 * Creates the test database if needed, applies migrations, and returns a client.
 *
 * Uses `migrate deploy` rather than `db push`, so the tests exercise the same
 * baseline migration that provisions production.
 */
export async function setupTestDatabase(): Promise<PrismaClient> {
  if (client) return client;

  const url = testDatabaseUrl();
  const adminUrl = url.replace(/\/[^/?]+(\?|$)/, '/postgres$1');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
  } catch {
    // Already exists — fine, migrations below are idempotent.
  } finally {
    await admin.$disconnect();
  }

  execSync('bunx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  client = new PrismaClient({ datasources: { db: { url } } });
  await client.$connect();
  return client;
}

/**
 * Empties every domain table between tests.
 *
 * TRUNCATE ... CASCADE rather than deleting per table, so a test never depends
 * on getting the foreign-key order right.
 */
export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      issue_status_changes,
      finding_occurrences,
      security_issues,
      assessment_summaries,
      assessment_configs,
      assessment_logs,
      plugin_executions,
      reports,
      assessments,
      endpoints,
      auth_configs,
      api_specs,
      projects,
      scan_profiles,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function teardownTestDatabase(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** Minimal project + assessment fixture. */
export async function seedProjectAndAssessment(
  prisma: PrismaClient,
  options: { projectId?: string; assessmentId?: string } = {},
) {
  const projectId = options.projectId ?? 'test-project';
  const assessmentId = options.assessmentId ?? 'test-assessment';

  const user = await prisma.user.create({
    data: { id: `user-${projectId}`, email: `${projectId}@test.local`, name: 'Test User' },
  });

  const project = await prisma.project.create({
    data: {
      id: projectId,
      name: 'Test API',
      baseUrl: 'https://api.test.local',
      userId: user.id,
    },
  });

  const assessment = await prisma.assessment.create({
    data: { id: assessmentId, projectId: project.id, status: 'RUNNING' },
  });

  return { user, project, assessment };
}
