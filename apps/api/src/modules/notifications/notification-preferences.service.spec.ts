import { describe, expect, it } from 'bun:test';
import type { NotificationType } from '@prisma/client';
import {
  DEFAULT_PREFERENCES,
  NotificationPreferencesService,
} from './notification-preferences.service';
import { definitionFor } from './notification-catalog';

/**
 * Preference resolution.
 *
 * The behaviour worth pinning is what happens for a user who has never opened
 * the settings screen: absence of a row must mean "all defaults", not "opted
 * out of everything". Getting that backwards would silently stop every new
 * account from receiving the notifications the product exists to deliver.
 */

function makeService(row: Record<string, boolean> | null) {
  const upserts: unknown[] = [];

  const prisma = {
    notificationPreference: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        upserts.push({ create, update });
        return { ...DEFAULT_PREFERENCES, ...(row ?? {}), ...update };
      },
    },
  };

  return { service: new NotificationPreferencesService(prisma as any), upserts };
}

describe('get', () => {
  it('returns the defaults when the user has no row', async () => {
    const { service } = makeService(null);

    expect(await service.get('user-1')).toEqual(DEFAULT_PREFERENCES);
  });

  it('does not create a row just to read one', async () => {
    // Reading a setting must not write to the database.
    const { service, upserts } = makeService(null);

    await service.get('user-1');

    expect(upserts).toHaveLength(0);
  });

  it('returns the stored values when a row exists', async () => {
    const { service } = makeService({ ...DEFAULT_PREFERENCES, scanCompleted: false, soundEnabled: true });

    const preferences = await service.get('user-1');

    expect(preferences.scanCompleted).toBe(false);
    expect(preferences.soundEnabled).toBe(true);
    expect(preferences.scanFailed).toBe(true);
  });
});

describe('defaults', () => {
  it('opts new users in to every event type', () => {
    expect(DEFAULT_PREFERENCES.scanCompleted).toBe(true);
    expect(DEFAULT_PREFERENCES.scanFailed).toBe(true);
    expect(DEFAULT_PREFERENCES.reportGenerated).toBe(true);
    expect(DEFAULT_PREFERENCES.reportFailed).toBe(true);
    expect(DEFAULT_PREFERENCES.newFindings).toBe(true);
    expect(DEFAULT_PREFERENCES.securityWarning).toBe(true);
    expect(DEFAULT_PREFERENCES.criticalFinding).toBe(true);
    expect(DEFAULT_PREFERENCES.systemError).toBe(true);
  });

  it('leaves sound and desktop off until the user asks for them', () => {
    // Neither should start because of a default the user never chose: one makes
    // noise, the other triggers a browser permission prompt.
    expect(DEFAULT_PREFERENCES.soundEnabled).toBe(false);
    expect(DEFAULT_PREFERENCES.desktopEnabled).toBe(false);
  });

  it('leaves email off until an administrator configures a provider', () => {
    // A self-hosted install has no mail provider until somebody sets one up.
    // Defaulting this on would queue deliveries that can only fail.
    expect(DEFAULT_PREFERENCES.emailEnabled).toBe(false);
  });
});

/**
 * The catalog's exhaustiveness, which is what fixed a real bug.
 *
 * `COLUMN_FOR_TYPE` previously listed six of the twelve notification types.
 * `wants()` indexed it with one of the other six, got `undefined`, and returned
 * it — so every NEW_FINDINGS, REPORT_FAILED, SCHEDULED_SCAN_* and EMAIL_*
 * notification was silently discarded at the preference gate. This asserts the
 * property that makes that impossible.
 */
describe('catalog coverage', () => {
  const ALL_TYPES: NotificationType[] = [
    'SCAN_COMPLETED',
    'SCAN_FAILED',
    'SCHEDULED_SCAN_COMPLETED',
    'SCHEDULED_SCAN_FAILED',
    'REPORT_GENERATED',
    'REPORT_FAILED',
    'NEW_FINDINGS',
    'CRITICAL_FINDING',
    'EMAIL_REPORT_SENT',
    'EMAIL_REPORT_FAILED',
    'SECURITY_WARNING',
    'SYSTEM_ERROR',
  ];

  it('has a definition for every notification type', () => {
    for (const type of ALL_TYPES) {
      const definition = definitionFor(type);
      expect(definition).toBeDefined();
      expect(definition.category).toBeString();
      expect(DEFAULT_PREFERENCES[definition.preference]).toBeBoolean();
    }
  });

  it('resolves a real boolean for every type, never undefined', async () => {
    const { service } = makeService(null);

    for (const type of ALL_TYPES) {
      // The specific regression: an unmapped type used to return `undefined`,
      // which is falsy, which silently suppressed the notification.
      expect(await service.wants('user-1', type)).toBe(true);
    }
  });

  it('files each type under the category its badge expects', () => {
    expect(definitionFor('SCAN_COMPLETED').category).toBe('SCANS');
    expect(definitionFor('SCHEDULED_SCAN_COMPLETED').category).toBe('SCANS');
    expect(definitionFor('REPORT_GENERATED').category).toBe('REPORTS');
    expect(definitionFor('NEW_FINDINGS').category).toBe('ISSUES');
    // ISSUES, not SECURITY: a finding badges the Issues screen, while SECURITY
    // means something happened to the installation itself.
    expect(definitionFor('CRITICAL_FINDING').category).toBe('ISSUES');
    expect(definitionFor('SECURITY_WARNING').category).toBe('SECURITY');
  });
});

describe('wantsEmail', () => {
  it('says no when the master switch is off, whatever the per-event switch says', async () => {
    const { service } = makeService({
      ...DEFAULT_PREFERENCES,
      emailEnabled: false,
      emailScanCompleted: true,
    });

    expect(await service.wantsEmail('user-1', 'SCAN_COMPLETED')).toBe(false);
  });

  it('says yes only when both the master and the per-event switch are on', async () => {
    const on = makeService({
      ...DEFAULT_PREFERENCES,
      emailEnabled: true,
      emailScanCompleted: true,
    });
    const off = makeService({
      ...DEFAULT_PREFERENCES,
      emailEnabled: true,
      emailScanCompleted: false,
    });

    expect(await on.service.wantsEmail('user-1', 'SCAN_COMPLETED')).toBe(true);
    expect(await off.service.wantsEmail('user-1', 'SCAN_COMPLETED')).toBe(false);
  });

  /**
   * Some types are in-app only, and no preference combination can change that.
   *
   * NEW_FINDINGS in particular: the scan-completed email already carries the
   * severity breakdown, so emailing it too would be the same news twice.
   */
  it('refuses to email a type the catalog marks in-app only', async () => {
    const { service } = makeService({ ...DEFAULT_PREFERENCES, emailEnabled: true });

    expect(await service.wantsEmail('user-1', 'NEW_FINDINGS')).toBe(false);
    expect(await service.wantsEmail('user-1', 'REPORT_FAILED')).toBe(false);
    // Mailing to confirm a mail, or to report that mail is broken, is a loop.
    expect(await service.wantsEmail('user-1', 'EMAIL_REPORT_SENT')).toBe(false);
    expect(await service.wantsEmail('user-1', 'EMAIL_REPORT_FAILED')).toBe(false);
  });
});

describe('update', () => {
  it('persists the new email preferences', async () => {
    const { service, upserts } = makeService(null);

    await service.update('user-1', { emailEnabled: true, emailScanFailed: false });

    expect((upserts[0] as any).update).toEqual({ emailEnabled: true, emailScanFailed: false });
  });

  it('ignores keys that are not preferences', async () => {
    const { service, upserts } = makeService(null);

    await service.update('user-1', { emailEnabled: true, hacked: 'yes' } as any);

    expect((upserts[0] as any).update).toEqual({ emailEnabled: true });
  });
});

describe('wants', () => {
  it.each<[NotificationType, keyof typeof DEFAULT_PREFERENCES]>([
    ['SCAN_COMPLETED', 'scanCompleted'],
    ['SCAN_FAILED', 'scanFailed'],
    ['REPORT_GENERATED', 'reportGenerated'],
    ['SECURITY_WARNING', 'securityWarning'],
    ['CRITICAL_FINDING', 'criticalFinding'],
    ['SYSTEM_ERROR', 'systemError'],
  ])('maps %s onto the %s preference', async (type, column) => {
    const off = makeService({ ...DEFAULT_PREFERENCES, [column]: false });
    const on = makeService({ ...DEFAULT_PREFERENCES, [column]: true });

    expect(await off.service.wants('user-1', type)).toBe(false);
    expect(await on.service.wants('user-1', type)).toBe(true);
  });

  it('says yes for every type when the user has no row', async () => {
    const { service } = makeService(null);

    expect(await service.wants('user-1', 'SCAN_COMPLETED')).toBe(true);
    expect(await service.wants('user-1', 'SYSTEM_ERROR')).toBe(true);
  });
});
