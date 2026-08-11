"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDatabaseUrl = testDatabaseUrl;
exports.setupTestDatabase = setupTestDatabase;
exports.resetTestDatabase = resetTestDatabase;
exports.teardownTestDatabase = teardownTestDatabase;
exports.seedProjectAndAssessment = seedProjectAndAssessment;
const child_process_1 = require("child_process");
const client_1 = require("@prisma/client");
const TEST_DATABASE_NAME = 'api_analyser_test';
function testDatabaseUrl() {
    const base = process.env.DATABASE_URL;
    if (!base)
        throw new Error('DATABASE_URL must be set to run integration tests.');
    return base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DATABASE_NAME}$1`);
}
let client = null;
async function setupTestDatabase() {
    if (client)
        return client;
    const url = testDatabaseUrl();
    const adminUrl = url.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
    const admin = new client_1.PrismaClient({ datasources: { db: { url: adminUrl } } });
    try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
    catch {
    }
    finally {
        await admin.$disconnect();
    }
    (0, child_process_1.execSync)('bunx prisma migrate deploy', {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    client = new client_1.PrismaClient({ datasources: { db: { url } } });
    await client.$connect();
    return client;
}
async function resetTestDatabase(prisma) {
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
async function teardownTestDatabase() {
    if (client) {
        await client.$disconnect();
        client = null;
    }
}
async function seedProjectAndAssessment(prisma, options = {}) {
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
//# sourceMappingURL=db.js.map