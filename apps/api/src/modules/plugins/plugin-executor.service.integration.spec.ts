import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PluginExecutorService } from './plugin-executor.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * There is no per-project ownership boundary in this product: one
 * installation is one company, and every authenticated user may run a plugin
 * against any project, the same as starting a scan — see
 * `ProjectsService.findAll`. This suite pins that a different user gets the
 * same result as the project's creator, and that a genuinely unknown project
 * id still 404s before any scan traffic is sent.
 */

let prisma: PrismaClient;
let service: PluginExecutorService;

const OWNER = 'plugin-exec-owner';
const OTHER = 'plugin-exec-other';
const PROJECT = 'plugin-exec-project';

/** A plugin whose `run()` proves whether it was ever invoked and with what auth. */
function spyingRegistry(onRun: (context: any) => void) {
  const plugin = {
    manifest: { id: 'spy', name: 'Spy Plugin' },
    run: async (context: any) => {
      onRun(context);
      return { pluginId: 'spy', pluginName: 'Spy Plugin', findings: [], scanDuration: 0, endpointsTested: 0 };
    },
  };
  return { getById: (id: string) => (id === 'spy' ? plugin : undefined) } as any;
}

beforeAll(async () => {
  prisma = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await prisma.user.create({ data: { id: OWNER, email: 'owner@plugin-exec.test', name: 'Owner' } });
  await prisma.user.create({ data: { id: OTHER, email: 'other@plugin-exec.test', name: 'Other' } });
  // PluginExecution.pluginId is a real foreign key into the plugin catalog —
  // needed to reach a completed execution row instead of failing on an
  // unrelated constraint.
  await prisma.plugin.upsert({
    where: { id: 'spy' },
    update: {},
    create: { id: 'spy', name: 'Spy Plugin', description: 'test double', category: 'HEADERS', owaspMappings: [] },
  });
  await prisma.project.create({
    data: { id: PROJECT, name: 'Shared Project', baseUrl: 'https://shared.test.local', userId: OWNER },
  });
  await prisma.apiSpec.create({
    data: {
      projectId: PROJECT,
      source: 'UPLOAD',
      rawSpec: {},
      parsed: {},
      authConfig: { create: { type: 'BEARER', token: 'shared-secret-token' } },
      endpoints: { create: [{ path: '/widgets', method: 'GET', tags: [], parameters: [], responses: {}, security: [] }] },
    },
  });
});

describe('PluginExecutorService.runSinglePlugin — shared installation', () => {
  it('lets a different user in the same installation run a plugin against the project', async () => {
    let receivedAuthToken: string | undefined;
    service = new PluginExecutorService(
      prisma as any,
      spyingRegistry((context) => { receivedAuthToken = context.auth.token; }),
    );

    const result = await service.runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: OTHER });

    expect(result.status).toBe('SUCCESS');
    expect(receivedAuthToken).toBe('shared-secret-token');
  });

  it('allows the project creator to run a plugin against their own project', async () => {
    let receivedAuthToken: string | undefined;
    service = new PluginExecutorService(
      prisma as any,
      spyingRegistry((context) => { receivedAuthToken = context.auth.token; }),
    );

    const result = await service.runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: OWNER });

    expect(result.status).toBe('SUCCESS');
    expect(receivedAuthToken).toBe('shared-secret-token');
  });

  it('rejects a nonexistent project before any scan traffic is sent', async () => {
    let invoked = false;
    service = new PluginExecutorService(prisma as any, spyingRegistry(() => { invoked = true; }));

    await expect(
      service.runSinglePlugin({ pluginId: 'spy', projectId: 'does-not-exist', userId: OTHER }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(invoked).toBe(false);
  });

  it('never records a PluginExecution row for a rejected attempt', async () => {
    service = new PluginExecutorService(prisma as any, spyingRegistry(() => {}));

    await service.runSinglePlugin({ pluginId: 'spy', projectId: 'does-not-exist', userId: OTHER }).catch(() => {});

    const executions = await prisma.pluginExecution.findMany({ where: { userId: OTHER } });
    expect(executions).toHaveLength(0);
  });
});
