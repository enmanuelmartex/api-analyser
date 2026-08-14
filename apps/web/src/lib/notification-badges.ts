import type { NotificationSection, NotificationSummary } from '@/types';

/**
 * The rules behind the sidebar badges and the bell, as pure functions.
 *
 * Kept out of the components so they can be tested without a DOM: the project's
 * web tests run under `bun test` with no jsdom, and the interesting behaviour
 * here — when a badge appears, what it reads, what happens to the total when a
 * section is cleared — is arithmetic, not rendering.
 */

/** Above this the badge shows `99+` rather than widening the sidebar. */
export const BADGE_MAX = 99;

/**
 * What a badge should read, or null when there should be no badge.
 *
 * Null at zero is the rule, not a detail: an item with nothing new must look
 * exactly like one that has never had anything new. "Scans 0" is worse than no
 * badge, because it draws the eye to the absence of news.
 */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(Math.floor(count));
}

/** The accessible name for a badge, which a bare number cannot supply. */
export function badgeAriaLabel(count: number): string {
  return `${count} unread`;
}

/**
 * The summary after a section is marked read, for the optimistic update.
 *
 * The total drops by exactly what the section held rather than being recomputed
 * from the three badged sections — the total also counts SECURITY and SYSTEM,
 * which have no sidebar entry, and rebuilding it from the visible three would
 * silently discard them and make the bell under-report.
 */
export function applySectionRead(
  summary: NotificationSummary,
  section: NotificationSection,
): NotificationSummary {
  const cleared = summary[section];

  return {
    ...summary,
    [section]: 0,
    totalUnread: Math.max(summary.totalUnread - cleared, 0),
  };
}

/**
 * Should visiting this section clear anything?
 *
 * Guards the mark-read call so a navigation to a section with nothing unread
 * does not write to the database.
 */
export function hasUnread(summary: NotificationSummary, section: NotificationSection): boolean {
  return summary[section] > 0;
}
