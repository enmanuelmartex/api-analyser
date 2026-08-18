import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PluginExecutorService } from './plugin-executor.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * `POST /plugins/:id/run` used to look the target project up with
 * `project.findUniqueOrThrow({ where: { id: projectId } })` — no `userId`
 * filter — even though `projectId` comes straight from the request body. Any
 * authenticated user could run a check against any other user's project,
 * using that project's own stored credentials (bearer token, API key,
 * whatever `AuthConfig` holds), and get the unredacted findings — including
 * raw HTTP evidence — back in the response. This is the regression test for
 * the fix: the project lookup is now scoped by `{ id: projectId, userId }`,
 * exactly like every other id-bearing method in this codebase.
 */

let prisma: PrismaClient;
let service: PluginExecutorService;

const OWNER = 'plugin-exec-owner';
const ATTACKER = 'plugin-exec-attacker';
const PROJECT = 'plugin-exec-victim-project';

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
  await prisma.user.create({ data: { id: ATTACKER, email: 'attacker@plugin-exec.test', name: 'Attacker' } });
  // PluginExecution.pluginId is a real foreign key into the plugin catalog —
  // needed for the "owner runs their own plugin" case to reach a completed
  // execution row instead of failing on an unrelated constraint.
  await prisma.plugin.upsert({
    where: { id: 'spy' },
    update: {},
    create: { id: 'spy', name: 'Spy Plugin', description: 'test double', category: 'HEADERS', owaspMappings: [] },
  });
  await prisma.project.create({
    data: { id: PROJECT, name: 'Victim Project', baseUrl: 'https://victim.test.local', userId: OWNER },
  });
  await prisma.apiSpec.create({
    data: {
      projectId: PROJECT,
      source: 'UPLOAD',
      rawSpec: {},
      parsed: {},
      authConfig: { create: { type: 'BEARER', token: 'victim-secret-token' } },
      endpoints: { create: [{ path: '/widgets', method: 'GET', tags: [], parameters: [], responses: {}, security: [] }] },
    },
  });
});

describe('PluginExecutorService.runSinglePlugin — cross-tenant project access', () => {
  it('refuses to run a plugin against a project the caller does not own', async () => {
    let invoked = false;
    service = new PluginExecutorService(prisma as any, spyingRegistry(() => { invoked = true; }));

    await expect(
      service.runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: ATTACKER }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Never even reached the point of building a ScanContext with the
    // victim's credentials — the whole point of rejecting before the try
    // block, not inside it.
    expect(invoked).toBe(false);
  });

  it('never records a PluginExecution row for a rejected cross-tenant attempt', async () => {
    service = new PluginExecutorService(prisma as any, spyingRegistry(() => {}));

    await service.runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: ATTACKER }).catch(() => {});

    const executions = await prisma.pluginExecution.findMany({ where: { userId: ATTACKER } });
    expect(executions).toHaveLength(0);
  });

  it('allows the actual owner to run a plugin against their own project', async () => {
    let receivedAuthToken: string | undefined;
    service = new PluginExecutorService(
      prisma as any,
      spyingRegistry((context) => { receivedAuthToken = context.auth.token; }),
    );

    const result = await service.runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: OWNER });

    expect(result.status).toBe('SUCCESS');
    expect(receivedAuthToken).toBe('victim-secret-token');
  });

  it('responds the same way for a nonexistent project as for one that is not owned', async () => {
    service = new PluginExecutorService(prisma as any, spyingRegistry(() => {}));

    const forOther = service
      .runSinglePlugin({ pluginId: 'spy', projectId: PROJECT, userId: ATTACKER })
      .catch((e) => e.message);
    const forMissing = service
      .runSinglePlugin({ pluginId: 'spy', projectId: 'does-not-exist', userId: OWNER })
      .catch((e) => e.message);

    expect(await forOther).toEqual(await forMissing);
  });
});
