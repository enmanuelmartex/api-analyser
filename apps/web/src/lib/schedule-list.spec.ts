import { describe, expect, it } from 'bun:test';
import {
  ANY,
  EMPTY_SCHEDULE_FILTERS,
  formatCountdown,
  formatInZone,
  hasActiveScheduleFilters,
  nextRunLabel,
  parseScheduleFilters,
  parseSchedulePage,
  serializeScheduleFilters,
  toApiValue,
} from './schedule-list';

describe('filter state ↔ URL', () => {
  it('round-trips every filter', () => {
    const filters = { search: 'payment', status: 'ACTIVE', frequency: 'WEEKLY', projectId: 'p-1' };
    expect(parseScheduleFilters(new URLSearchParams(serializeScheduleFilters(filters)))).toEqual(
      filters,
    );
  });

  it('omits inactive filters, so a clean view has a clean URL', () => {
    expect(serializeScheduleFilters(EMPTY_SCHEDULE_FILTERS)).toBe('');
  });

  it('drops the page when a filter changes', () => {
    // Keeping the offset would land on an empty page whenever the narrower
    // result set is shorter than the old one.
    expect(serializeScheduleFilters({ ...EMPTY_SCHEDULE_FILTERS, status: 'PAUSED' })).toBe(
      'status=PAUSED',
    );
  });

  it('reads a sane page number out of anything', () => {
    expect(parseSchedulePage(new URLSearchParams('page=3'))).toBe(3);
    expect(parseSchedulePage(new URLSearchParams('page=0'))).toBe(1);
    expect(parseSchedulePage(new URLSearchParams('page=-2'))).toBe(1);
    expect(parseSchedulePage(new URLSearchParams('page=banana'))).toBe(1);
    expect(parseSchedulePage(new URLSearchParams())).toBe(1);
  });

  it('never sends the "no filter" sentinel to the API', () => {
    expect(toApiValue(ANY)).toBeUndefined();
    expect(toApiValue('ACTIVE')).toBe('ACTIVE');
  });

  it('knows when anything is filtered', () => {
    expect(hasActiveScheduleFilters(EMPTY_SCHEDULE_FILTERS)).toBe(false);
    expect(hasActiveScheduleFilters({ ...EMPTY_SCHEDULE_FILTERS, search: 'x' })).toBe(true);
    expect(hasActiveScheduleFilters({ ...EMPTY_SCHEDULE_FILTERS, frequency: 'DAILY' })).toBe(true);
  });
});

describe('formatInZone', () => {
  it('renders the instant in the SCHEDULE’s zone, not the browser’s', () => {
    // The reason a zone is stored per schedule. 06:00Z is 02:00 in Santo
    // Domingo — the time the operator configured — and 08:00 in Madrid.
    const instant = '2026-08-17T06:00:00Z';
    expect(formatInZone(instant, 'America/Santo_Domingo')).toContain('2:00 AM');
    expect(formatInZone(instant, 'Europe/Madrid')).toContain('8:00 AM');
  });

  it('renders a placeholder rather than "Invalid Date"', () => {
    expect(formatInZone(null, 'UTC')).toBe('—');
    expect(formatInZone(undefined, 'UTC')).toBe('—');
    expect(formatInZone('not-a-date', 'UTC')).toBe('—');
  });

  it('falls back to local time instead of blanking the page on a bad zone', () => {
    // The server validates the zone, so this should be unreachable — but a
    // RangeError thrown inside a table cell would take down the whole route.
    expect(formatInZone('2026-08-17T06:00:00Z', 'Mars/Olympus_Mons')).not.toBe('—');
  });
});

describe('formatCountdown', () => {
  it('reads forwards and backwards', () => {
    const inTwoHours = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

    expect(formatCountdown(inTwoHours)).toBe('in 2 hours');
    expect(formatCountdown(threeDaysAgo)).toBe('3 days ago');
  });

  it('is empty when there is nothing to count down to', () => {
    expect(formatCountdown(null)).toBe('');
  });
});

describe('nextRunLabel', () => {
  it('says Paused rather than showing a date that will not happen', () => {
    // Showing a stale date on a paused schedule would suggest it is still
    // going to scan, which is the opposite of what the operator asked for.
    expect(nextRunLabel('2026-08-17T06:00:00Z', 'PAUSED', 'UTC')).toBe('Paused');
  });

  it('shows the next run for an active schedule', () => {
    expect(nextRunLabel('2026-08-17T06:00:00Z', 'ACTIVE', 'America/Santo_Domingo')).toContain(
      '2:00 AM',
    );
  });

  it('shows a dash when a schedule has no next run', () => {
    expect(nextRunLabel(null, 'COMPLETED', 'UTC')).toBe('—');
  });
});
