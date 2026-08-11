/**
 * API Analyser development seed.
 *
 * Deterministic and idempotent: running it any number of times converges to the
 * same state. Every write is an upsert keyed on a stable identifier, so ids
 * never churn and no unique constraint is ever violated.
 *
 * Contains no real secrets. The demo passwords below are local-development
 * credentials, already published in README.md, and exist only so a fresh clone
 * can sign in. They are not valid anywhere else.
 *
 * Plugins are intentionally NOT seeded here: PluginRegistryService.onModuleInit
 * upserts all built-in checks from the code registry when the API boots, which
 * is the single source of truth for what is installed. Seeding them too would
 * create a second, drifting definition.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Stable ids so repeated runs update rather than insert. */
const IDS = {
  adminUser: 'seed-user-admin',
  analystUser: 'seed-user-analyst',
  demoProject: 'seed-project-petstore',
} as const;

/**
 * Minimal but valid OpenAPI 3.0 document, embedded rather than fetched so
 * seeding works offline and produces byte-identical results every run.
 */
const DEMO_SPEC = {
  openapi: '3.0.0',
  info: { title: 'PetStore Demo API', version: '1.0.0' },
  paths: {
    '/pet/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Find pet by ID',
        tags: ['pet'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'successful operation' } },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        tags: ['pet'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'successful operation' } },
      },
    },
    '/pet/findByStatus': {
      get: {
        operationId: 'findPetsByStatus',
        summary: 'Finds pets by status',
        tags: ['pet'],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'successful operation' } },
      },
    },
    '/store/order': {
      post: {
        operationId: 'placeOrder',
        summary: 'Place an order for a pet',
        tags: ['store'],
        responses: { '200': { description: 'successful operation' } },
      },
    },
    '/user/login': {
      get: {
        operationId: 'loginUser',
        summary: 'Log user into the system',
        tags: ['user'],
        parameters: [
          { name: 'username', in: 'query', schema: { type: 'string' } },
          { name: 'password', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'successful operation' } },
      },
    },
  },
} as const;

/** Endpoints derived from DEMO_SPEC, in a stable order. */
const DEMO_ENDPOINTS = [
  { path: '/pet/{petId}', method: 'GET' as const, operationId: 'getPetById', summary: 'Find pet by ID', tags: ['pet'] },
  { path: '/pet/{petId}', method: 'DELETE' as const, operationId: 'deletePet', summary: 'Delete a pet', tags: ['pet'] },
  { path: '/pet/findByStatus', method: 'GET' as const, operationId: 'findPetsByStatus', summary: 'Finds pets by status', tags: ['pet'] },
  { path: '/store/order', method: 'POST' as const, operationId: 'placeOrder', summary: 'Place an order for a pet', tags: ['store'] },
  { path: '/user/login', method: 'GET' as const, operationId: 'loginUser', summary: 'Log user into the system', tags: ['user'] },
];

// System scan profiles are NOT seeded here. ProfilesService.onModuleInit already
// upserts them from its own SYSTEM_PROFILES list on every boot, the same pattern
// the plugin registry uses. Seeding them here as well created a second source of
// truth and produced duplicate names in the UI ("Quick Scan" twice, "OWASP API
// Top 10" twice) because the two lists used different ids.

async function seedUsers() {
  // Local development credentials only — see the file header.
  const adminPassword = await bcrypt.hash('Admin@123!', 12);
  const analystPassword = await bcrypt.hash('Analyst@123!', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@apianalyser.local' },
    // Password intentionally not in `update`: re-seeding must not silently
    // reset a password an operator changed locally.
    update: { name: 'API Analyser Admin', role: 'ADMIN', isActive: true },
    create: {
      id: IDS.adminUser,
      email: 'admin@apianalyser.local',
      name: 'API Analyser Admin',
      password: adminPassword,
      role: 'ADMIN',
      emailVerified: true,
    },
  });

  const analyst = await prisma.user.upsert({
    where: { email: 'analyst@apianalyser.local' },
    update: { name: 'Security Analyst', role: 'ANALYST', isActive: true },
    create: {
      id: IDS.analystUser,
      email: 'analyst@apianalyser.local',
      name: 'Security Analyst',
      password: analystPassword,
      role: 'ANALYST',
      emailVerified: true,
    },
  });

  return { admin, analyst };
}

async function seedDemoProject(ownerId: string) {
  // READY requires a spec, endpoints and a resolved auth configuration. The
  // previous seed created a READY project with no ApiSpec at all — an
  // impossible state that `createAndRun` rejects at scan time.
  const project = await prisma.project.upsert({
    where: { id: IDS.demoProject },
    update: {
      name: 'PetStore Demo API',
      description: 'Swagger PetStore API — used for API Analyser demonstration',
      baseUrl: 'https://petstore3.swagger.io/api/v3',
      environment: 'DEVELOPMENT',
      assetCriticality: 'LOW',
      status: 'READY',
      setupStep: 3,
    },
    create: {
      id: IDS.demoProject,
      name: 'PetStore Demo API',
      description: 'Swagger PetStore API — used for API Analyser demonstration',
      baseUrl: 'https://petstore3.swagger.io/api/v3',
      environment: 'DEVELOPMENT',
      assetCriticality: 'LOW',
      tags: ['demo', 'petstore', 'openapi'],
      status: 'READY',
      setupStep: 3,
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      userId: ownerId,
    },
  });

  const apiSpec = await prisma.apiSpec.upsert({
    where: { projectId: project.id },
    update: {
      rawSpec: DEMO_SPEC as any,
      parsed: DEMO_SPEC as any,
      title: DEMO_SPEC.info.title,
      version: DEMO_SPEC.info.version,
    },
    create: {
      projectId: project.id,
      source: 'MANUAL',
      rawSpec: DEMO_SPEC as any,
      parsed: DEMO_SPEC as any,
      title: DEMO_SPEC.info.title,
      version: DEMO_SPEC.info.version,
      format: 'openapi',
    },
  });

  // Upsert per endpoint on the natural key, so re-seeding neither duplicates
  // rows nor churns their ids (which FindingOccurrence references).
  for (const endpoint of DEMO_ENDPOINTS) {
    await prisma.endpoint.upsert({
      where: {
        apiSpecId_path_method: {
          apiSpecId: apiSpec.id,
          path: endpoint.path,
          method: endpoint.method,
        },
      },
      update: {
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        tags: endpoint.tags,
      },
      create: {
        apiSpecId: apiSpec.id,
        path: endpoint.path,
        method: endpoint.method,
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        tags: endpoint.tags,
        parameters: [],
        responses: {},
        security: [],
      },
    });
  }

  // The public PetStore demo needs no credentials. NONE is a complete auth
  // configuration, which is what makes the project genuinely READY.
  await prisma.authConfig.upsert({
    where: { apiSpecId: apiSpec.id },
    update: { type: 'NONE' },
    create: { apiSpecId: apiSpec.id, type: 'NONE' },
  });

  return { project, apiSpec };
}


async function main() {
  console.log('Seeding API Analyser database...');

  const { admin, analyst } = await seedUsers();
  const { project } = await seedDemoProject(analyst.id);

  console.log(`  users            ${admin.email}, ${analyst.email}`);
  console.log(`  demo project     ${project.name} (READY, ${DEMO_ENDPOINTS.length} endpoints)`);
  console.log('');
  console.log('Development credentials (local only):');
  console.log('  admin@apianalyser.local   / Admin@123!');
  console.log('  analyst@apianalyser.local / Analyst@123!');
  console.log('');
  console.log('Built-in security checks are registered by the API on startup.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
