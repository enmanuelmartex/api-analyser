'use client';

import Link from 'next/link';
import {
  IconAlertTriangle,
  IconBell,
  IconBug,
  IconCircleCheck,
  IconCircleX,
  IconFileText,
  IconMail,
} from '@tabler/icons-react';
import { cn, formatDay, formatTimeOfDay } from '@/lib/utils';
import type { AppNotification, NotificationType } from '@/types';

/**
 * One notification, rendered the same way wherever it appears.
 *
 * The bell's panel and the notifications screen show the same rows: the panel
 * is a window onto the first few, so a row that looked different there would
 * read as a different kind of object. Only the timestamp changes — see
 * `timestamp` below.
 */

/**
 * Which icon each notification type gets.
 *
 * A lookup rather than a chain of conditionals, and total over the type union,
 * so adding a notification type is a compile error here until it is given an
 * icon — the same discipline the backend catalog enforces.
 */
const ICONS: Record<NotificationType, typeof IconBell> = {
  SCAN_COMPLETED: IconCircleCheck,
  SCHEDULED_SCAN_COMPLETED: IconCircleCheck,
  SCAN_FAILED: IconCircleX,
  SCHEDULED_SCAN_FAILED: IconCircleX,
  REPORT_GENERATED: IconFileText,
  REPORT_FAILED: IconCircleX,
  NEW_FINDINGS: IconBug,
  CRITICAL_FINDING: IconAlertTriangle,
  EMAIL_REPORT_SENT: IconMail,
  EMAIL_REPORT_FAILED: IconMail,
  SECURITY_WARNING: IconAlertTriangle,
  SYSTEM_ERROR: IconAlertTriangle,
};

/**
 * Severity → colour, for the icon only.
 *
 * Severity colour is legitimate here in a way it is not on a sidebar badge: this
 * row describes one event, and its severity is a property of that event. All
 * four are theme tokens, so they follow dark mode.
 */
const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'text-destructive',
  ERROR: 'text-destructive',
  WARNING: 'text-warning',
  INFO: 'text-muted-foreground',
  DEBUG: 'text-muted-foreground',
};

/** "2 min ago". Relative time, formatted without pulling in a date library. */
export function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Past a week the interval stops being informative and the date takes over —
  // in the account's own format and timezone, like every other date on screen.
  return formatDay(iso);
}

export function NotificationRow({
  notification,
  onOpen,
  onMarkRead,
  /**
   * `relative` in the panel, where a row has no context but the one before it.
   *
   * `time` on the screen, where the rows already sit under a day heading — "14h
   * ago" inside a group labelled Today is the same fact twice, and worse at it.
   */
  timestamp = 'relative',
}: {
  notification: AppNotification;
  onOpen: () => void;
  onMarkRead: () => void;
  timestamp?: 'relative' | 'time';
}) {
  const Icon = ICONS[notification.type] ?? IconBell;
  const tone = SEVERITY_TONE[notification.severity] ?? 'text-muted-foreground';

  const body = (
    <div className="flex gap-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm',
            // Unread is heavier and full-contrast; read drops to normal weight
            // and muted. That is the whole distinction — a coloured background
            // on every unread row turns the list into a block of colour.
            notification.read ? 'font-normal text-muted-foreground' : 'font-medium text-foreground',
          )}
        >
          {notification.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {timestamp === 'time'
            ? formatTimeOfDay(notification.createdAt)
            : relativeTime(notification.createdAt)}
        </p>
      </div>
      {!notification.read && (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
      )}
    </div>
  );

  return (
    <li className="group/row relative">
      {notification.href ? (
        <Link
          href={notification.href}
          onClick={onOpen}
          className="block px-4 py-3 transition-colors hover:bg-accent/50"
        >
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3">{body}</div>
      )}

      {!notification.read && (
        <button
          type="button"
          onClick={(event) => {
            // The row is a link; marking read must not also navigate.
            event.preventDefault();
            event.stopPropagation();
            onMarkRead();
          }}
          className={cn(
            'absolute right-3 top-2 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground',
            // Revealed on hover and on keyboard focus — focus-within is what
            // keeps it reachable without a mouse.
            'opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none',
            'group-hover/row:opacity-100',
          )}
        >
          Mark as read
        </button>
      )}
    </li>
  );
}
