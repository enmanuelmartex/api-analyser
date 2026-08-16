import { describe, expect, it } from 'bun:test';
import { NotificationsService } from './notifications.service';
import { DEFAULT_PREFERENCES } from './notification-preferences.service';

/**
 * The two gates a notification must pass, and the ownership scoping.
 *
 * The gates decide whether a row is written at all; the scoping is what stops
 * one user marking another user's notification read. Both are enforced in the
 * service rather than the controller, so they hold for every caller.
 */

function makeService(
  options: {
    globallyEnabled?: boolean;
    preferences?: Partial<typeof DEFAULT_PREFERENCES>;
    admins?: { id: string }[];
    updateCount?: number;
    deleteCount?: number;
  } = {},
) {
  const created: any[] = [];
  const published: { userId: string }[] = [];
  const deleteArgs: any[] = [];
  const findArgs: any[] = [];
  const countArgs: any[] = [];

  const prisma = {
    notification: {
      create: async ({ data }: any) => {
        created.push(data);
        return { id: `n-${created.length}`, ...data };
      },
      updateMany: async () => ({ count: options.updateCount ?? 1 }),
      deleteMany: async (args: any) => {
        deleteArgs.push(args);
        return { count: options.deleteCount ?? 7 };
      },
      count: async (args: any) => {
        countArgs.push(args);
        return countArgs.length;
      },
      findMany: async (args: any) => {
        findArgs.push(args);
        return [];
      },
    },
    user: { findMany: async () => options.admins ?? [] },
  };

  const settings = {
    getBoolean: async () => options.globallyEnabled ?? true,
  };

  const preferences = {
    wants: async (_userId: string, type: string) => {
      const map: Record<string, keyof typeof DEFAULT_PREFERENCES> = {
        SCAN_COMPLETED: 'scanCompleted',
        SCAN_FAILED: 'scanFailed',
        REPORT_GENERATED: 'reportGenerated',
        SECURITY_WARNING: 'securityWarning',
        CRITICAL_FINDING: 'criticalFinding',
        SYSTEM_ERROR: 'systemError',
      };
      const merged = { ...DEFAULT_PREFERENCES, ...(options.preferences ?? {}) };
      return merged[map[type]];
    },
  };

  const stream = { publish: (userId: string) => published.push({ userId }) };

  const service = new NotificationsService(
    prisma as any,
    settings as any,
    preferences as any,
    stream as any,
  );

  return { service, created, published, deleteArgs, findArgs, countArgs };
}

const INPUT = {
  userId: 'user-1',
  type: 'SCAN_COMPLETED' as const,
  category: 'SCANS' as const,
  title: 'Scan completed',
  message: 'No findings were detected.',
};

describe('create', () => {
  it('writes the notification and pushes it to the live stream', async () => {
    const { service, created, published } = makeService();

    const result = await service.create(INPUT);

    expect(result).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0].userId).toBe('user-1');
    expect(published).toEqual([{ userId: 'user-1' }]);
  });

  it('creates nothing when the operator has switched notifications off', async () => {
    const { service, created } = makeService({ globallyEnabled: false });

    expect(await service.create(INPUT)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('creates nothing when the recipient has muted that event type', async () => {
    const { service, created } = makeService({ preferences: { scanCompleted: false } });

    expect(await service.create(INPUT)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('still creates other types when one is muted', async () => {
    const { service, created } = makeService({ preferences: { scanCompleted: false } });

    await service.create({ ...INPUT, type: 'SCAN_FAILED', title: 'Scan failed' });

    expect(created).toHaveLength(1);
  });
});

describe('createForAdmins', () => {
  it('creates one notification per active administrator', async () => {
    const { service, created } = makeService({
      admins: [{ id: 'admin-1' }, { id: 'admin-2' }],
    });

    const count = await service.createForAdmins({
      type: 'SYSTEM_ERROR',
      category: 'SYSTEM',
      title: 'System error',
      message: 'The worker crashed.',
    });

    expect(count).toBe(2);
    expect(created.map((row) => row.userId).sort()).toEqual(['admin-1', 'admin-2']);
  });

  it('reports zero when there is no administrator to tell', async () => {
    const { service } = makeService({ admins: [] });

    expect(
      await service.createForAdmins({
        type: 'SYSTEM_ERROR',
        category: 'SYSTEM',
        title: 'System error',
        message: 'The worker crashed.',
      }),
    ).toBe(0);
  });
});

describe('ownership', () => {
  it('rejects marking a notification that is not the caller‘s', async () => {
    // updateMany matched nothing, which is what happens when the id exists but
    // belongs to someone else.
    const { service } = makeService({ updateCount: 0 });

    await expect(service.markRead('n-1', 'user-2')).rejects.toThrow(/not found/i);
  });

  it('rejects deleting a notification that is not the caller‘s', async () => {
    const { service } = makeService({ deleteCount: 0 });

    await expect(service.remove('n-1', 'user-2')).rejects.toThrow(/not found/i);
  });
});

/**
 * The period filter behind the notifications screen.
 *
 * What matters is which counts move with it: `total` has to, or the pager keeps
 * offering pages outside the chosen period, and the unread count must not, or
 * it contradicts the bell it sits beside.
 */
describe('findAll', () => {
  it('floors the query at `since` when a period is given', async () => {
    const { service, findArgs, countArgs } = makeService();

    const since = new Date('2026-08-08T00:00:00Z');
    await service.findAll('user-1', { since, limit: 20 });

    expect(findArgs[0].where.createdAt.gte).toEqual(since);
    // The page count is filtered with the rows…
    expect(countArgs[0].where.createdAt.gte).toEqual(since);
    // …and the unread total is not: that number belongs to the bell.
    expect(countArgs[1].where).toEqual({ userId: 'user-1', read: false });
  });

  it('reads the whole history when no period is given', async () => {
    const { service, findArgs } = makeService();

    await service.findAll('user-1', {});

    expect(findArgs[0].where).toEqual({ userId: 'user-1' });
  });

  it('combines the period with the unread-only filter', async () => {
    const { service, findArgs } = makeService();

    const since = new Date('2026-08-14T00:00:00Z');
    await service.findAll('user-1', { since, unreadOnly: true });

    expect(findArgs[0].where).toEqual({
      userId: 'user-1',
      read: false,
      createdAt: { gte: since },
    });
  });

  it('caps an oversized page rather than trusting the caller', async () => {
    const { service, findArgs } = makeService();

    await service.findAll('user-1', { limit: 5000, offset: -3 });

    expect(findArgs[0].take).toBe(100);
    expect(findArgs[0].skip).toBe(0);
  });
});

describe('deleteReadOlderThan', () => {
  it('only removes notifications that have been read', async () => {
    // An unread notification is still pending work for its recipient. Deleting
    // it means they never learn their scan failed.
    const { service, deleteArgs } = makeService();

    const before = new Date('2026-01-01T00:00:00Z');
    const count = await service.deleteReadOlderThan(before);

    expect(count).toBe(7);
    expect(deleteArgs[0].where.read).toBe(true);
    expect(deleteArgs[0].where.createdAt.lt).toEqual(before);
  });
});
