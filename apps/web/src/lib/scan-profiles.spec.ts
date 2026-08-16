import { describe, expect, it } from 'bun:test';
import type { ScanProfile } from '@/types';
import { groupScanProfiles } from './scan-profiles';

const profile = (over: Partial<ScanProfile> & Pick<ScanProfile, 'id'>): ScanProfile => ({
  name: over.id,
  isSystem: false,
  enabledPlugins: ['cors'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const seeded = [
  profile({ id: 'full-scan', isSystem: true }),
  profile({ id: 'quick-scan', isSystem: true }),
  profile({ id: 'auth-audit', isSystem: true }),
  profile({ id: 'headers-audit', isSystem: true }),
  profile({ id: 'owasp-api-top10', isSystem: true }),
  profile({ id: 'compliance', isSystem: true }),
  profile({ id: 'mine', userId: 'user-1' }),
];

describe('groupScanProfiles', () => {
  it('keeps the built-in profiles instead of discarding them', () => {
    // The regression: the run sheet filtered on `!isSystem`, so every seeded
    // profile disappeared and the picker looked empty on a fresh install.
    const { system } = groupScanProfiles(seeded);

    expect(system.map((entry) => entry.id)).toEqual([
      'quick-scan',
      'auth-audit',
      'headers-audit',
      'owasp-api-top10',
      'compliance',
    ]);
  });

  it('hides Full Scan, which the "all enabled checks" mode already covers', () => {
    const { selectable } = groupScanProfiles(seeded);
    expect(selectable.some((entry) => entry.id === 'full-scan')).toBe(false);
  });

  it('still shows Full Scan when it is the saved selection', () => {
    // Editing a schedule created against it must not blank out the field.
    const { system, selectable } = groupScanProfiles(seeded, 'full-scan');
    expect(system[0]?.id).toBe('full-scan');
    expect(selectable.some((entry) => entry.id === 'full-scan')).toBe(true);
  });

  it('lists the user’s own profiles separately, system first in selectable', () => {
    const { custom, selectable } = groupScanProfiles(seeded);

    expect(custom.map((entry) => entry.id)).toEqual(['mine']);
    expect(selectable.at(-1)?.id).toBe('mine');
    expect(selectable).toHaveLength(6);
  });

  it('survives an unanswered query', () => {
    expect(groupScanProfiles(undefined)).toEqual({ system: [], custom: [], selectable: [] });
  });
});
