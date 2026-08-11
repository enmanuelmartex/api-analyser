"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const IDS = {
    demoProject: 'seed-project-petstore',
};
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
};
const DEMO_ENDPOINTS = [
    { path: '/pet/{petId}', method: 'GET', operationId: 'getPetById', summary: 'Find pet by ID', tags: ['pet'] },
    { path: '/pet/{petId}', method: 'DELETE', operationId: 'deletePet', summary: 'Delete a pet', tags: ['pet'] },
    { path: '/pet/findByStatus', method: 'GET', operationId: 'findPetsByStatus', summary: 'Finds pets by status', tags: ['pet'] },
    { path: '/store/order', method: 'POST', operationId: 'placeOrder', summary: 'Place an order for a pet', tags: ['store'] },
    { path: '/user/login', method: 'GET', operationId: 'loginUser', summary: 'Log user into the system', tags: ['user'] },
];
async function resolveOwner() {
    const owner = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true },
        orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
        throw new Error('No administrator found. Start the API once so it can create the first ' +
            'account, then run the seed again.');
    }
    return owner;
}
async function seedDemoProject(ownerId) {
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
            rawSpec: DEMO_SPEC,
            parsed: DEMO_SPEC,
            title: DEMO_SPEC.info.title,
            version: DEMO_SPEC.info.version,
        },
        create: {
            projectId: project.id,
            source: 'MANUAL',
            rawSpec: DEMO_SPEC,
            parsed: DEMO_SPEC,
            title: DEMO_SPEC.info.title,
            version: DEMO_SPEC.info.version,
            format: 'openapi',
        },
    });
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
    await prisma.authConfig.upsert({
        where: { apiSpecId: apiSpec.id },
        update: { type: 'NONE' },
        create: { apiSpecId: apiSpec.id, type: 'NONE' },
    });
    return { project, apiSpec };
}
async function main() {
    console.log('Seeding API Analyser demo data...');
    const owner = await resolveOwner();
    const { project } = await seedDemoProject(owner.id);
    console.log(`  owner            ${owner.email}`);
    console.log(`  demo project     ${project.name} (READY, ${DEMO_ENDPOINTS.length} endpoints)`);
    console.log('');
    console.log('Built-in security checks are registered by the API on startup.');
}
main()
    .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map