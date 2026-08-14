import { describe, expect, it } from 'bun:test';
import type { NotificationSummary } from '@/types';
import { applySectionRead, badgeLabel, hasUnread } from './notification-badges';

/**
 * The badge rules.
 *
 * These are the behaviours the sidebar promises: nothing at zero, a real number
 * when there is news, and a count that goes down when the user acts on it —
 * without the bell and the sidebar drifting apart.
 */

const SUMMARY: NotificationSummary = {
  totalUnread: 9,
  byCategory: { SCANS: 2, ISSUES: 5, REPORTS: 2 },
  scans: 2,
  issues: 5,
  reports: 2,
};

describe('badgeLabel', () => {
  it('renders nothing at zero', () => {
    // "Scans 0" must never appear: an item with nothing new should look exactly
    // like one that has never had anything new.
    expect(badgeLabel(0)).toBeNull();
  });

  it('renders nothing for a negative or non-finite count', () => {
    expect(badgeLabel(-1)).toBeNull();
    expect(badgeLabel(Number.NaN)).toBeNull();
  });

  it('renders the count when there is something new', () => {
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(2)).toBe('2');
    expect(badgeLabel(12)).toBe('12');
    expect(badgeLabel(99)).toBe('99');
  });

  it('caps at 99+ so a neglected section cannot widen the sidebar', () => {
    expect(badgeLabel(100)).toBe('99+');
    expect(badgeLabel(4820)).toBe('99+');
  });
});

describe('applySectionRead', () => {
  it('clears the section that was read', () => {
    const next = applySectionRead(SUMMARY, 'issues');

    expect(next.issues).toBe(0);
  });

  it('leaves the other sections alone', () => {
    const next = applySectionRead(SUMMARY, 'issues');

    // Opening Issues must not clear the scans the user has not looked at.
    expect(next.scans).toBe(2);
    expect(next.reports).toBe(2);
  });

  it('drops the bell‘s total by exactly what the section held', () => {
    const next = applySectionRead(SUMMARY, 'issues');

    expect(next.totalUnread).toBe(4);
  });

  /**
   * The bell counts categories the sidebar does not show.
   *
   * Recomputing the total from the three badged sections would discard the
   * SECURITY and SYSTEM notifications and make the bell under-report.
   */
  it('preserves unread counts from categories with no sidebar badge', () => {
    const withSecurity: NotificationSummary = {
      totalUnread: 12,
      byCategory: { SCANS: 2, ISSUES: 5, REPORTS: 2, SECURITY: 3 },
      scans: 2,
      issues: 5,
      reports: 2,
    };

    const next = applySectionRead(withSecurity, 'issues');

    // 12 − 5 = 7, which still includes the three security notifications.
    expect(next.totalUnread).toBe(7);
    expect(next.scans + next.issues + next.reports).toBe(4);
  });

  it('never drives the total below zero', () => {
    const inconsistent: NotificationSummary = {
      totalUnread: 1,
      byCategory: {},
      scans: 0,
      issues: 5,
      reports: 0,
    };

    expect(applySectionRead(inconsistent, 'issues').totalUnread).toBe(0);
  });

  it('does not mutate the summary it was given', () => {
    const next = applySectionRead(SUMMARY, 'issues');

    expect(SUMMARY.issues).toBe(5);
    expect(next).not.toBe(SUMMARY);
  });
});

describe('hasUnread', () => {
  it('is true only when the section has something to clear', () => {
    expect(hasUnread(SUMMARY, 'issues')).toBe(true);
    expect(hasUnread({ ...SUMMARY, issues: 0 }, 'issues')).toBe(false);
  });
});
