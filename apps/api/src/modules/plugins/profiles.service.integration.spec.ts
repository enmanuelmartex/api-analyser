import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ProfilesService } from './profiles.service';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '../../test/db';

/**
 * `findOne`/`update`/`remove` used to throw a bare `ForbiddenException()` for
 * a profile that exists but belongs to someone else, and `NotFoundException`
 * only when it truly does not exist — two different HTTP statuses that let a
 * caller enumerate which `scanProfileId`s belong to another user just by
 * watching for 403 vs 404, even though the profile body itself was never
 * exposed. Every other ownership check in this codebase collapses "doesn't
 * exist" and "exists but isn't yours" into the same generic 404 for exactly
 * this reason (see ProjectsService.assertOwner, for one). These tests pin the
 * fix — while keeping the *different*, legitimately informative rejection for
 * system profiles, which are visible to everyone and not a secret.
 */

let prisma: PrismaClient;
let service: ProfilesService;

const OWNER = 'profile-owner';
const OTHER = 'profile-other-user';
let ownedProfileId: string;

const fakeRegistry = { has: () => true } as any;

beforeAll(async () => {
  prisma = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await prisma.user.create({ data: { id: OWNER, email: 'owner@profile-spec.test', name: 'Owner' } });
  await prisma.user.create({ data: { id: OTHER, email: 'other@profile-spec.test', name: 'Other' } });

  service = new ProfilesService(prisma as any, fakeRegistry);
  await service.onModuleInit(); // seeds SYSTEM_PROFILES, same as it would at real app boot
  const created = await service.create(OWNER, { name: 'My Profile', enabledPlugins: ['cors'] });
  ownedProfileId = created.id;
});

describe('ProfilesService — ownership does not leak existence', () => {
  it('findOne: a nonexistent id and someone else\'s profile produce the identical error', async () => {
    const forOther = service.findOne(ownedProfileId, OTHER).catch((e) => ({ status: e.getStatus(), message: e.message }));
    const forMissing = service.findOne('does-not-exist', OWNER).catch((e) => ({ status: e.getStatus(), message: e.message }));

    const [otherResult, missingResult] = await Promise.all([forOther, forMissing]);
    expect(otherResult).toEqual(missingResult);
    expect((otherResult as any).status).toBe(404);
  });

  it('findOne: throws NotFoundException, never ForbiddenException, for another user\'s profile', async () => {
    await expect(service.findOne(ownedProfileId, OTHER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: rejects another user\'s profile as 404, and the owner can still update it', async () => {
    await expect(
      service.update(ownedProfileId, OTHER, { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const updated = await service.update(ownedProfileId, OWNER, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });

  it('remove: rejects another user\'s profile as 404, and the owner can still delete it', async () => {
    await expect(service.remove(ownedProfileId, OTHER)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.scanProfile.findUnique({ where: { id: ownedProfileId } })).not.toBeNull();

    await service.remove(ownedProfileId, OWNER);
    expect(await prisma.scanProfile.findUnique({ where: { id: ownedProfileId } })).toBeNull();
  });

  it('a system profile still identifies itself distinctly rather than as a generic 404', async () => {
    const systemProfile = await prisma.scanProfile.findFirst({ where: { isSystem: true } });
    expect(systemProfile).not.toBeNull();

    // Anyone can read it (system profiles are visible to all users)...
    await expect(service.findOne(systemProfile!.id, OTHER)).resolves.toBeDefined();

    // ...but nobody can modify or delete it, and the error says so specifically
    // rather than pretending it doesn't exist — it's not a secret.
    let updateError: any;
    try {
      await service.update(systemProfile!.id, OTHER, { name: 'Tampered' });
    } catch (e) {
      updateError = e;
    }
    expect(updateError).toBeInstanceOf(ForbiddenException);
    expect(updateError.message).toContain('Cannot modify system profiles');
  });
});
