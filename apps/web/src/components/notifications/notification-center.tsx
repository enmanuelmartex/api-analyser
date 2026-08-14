'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBell,
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconFileText,
  IconMail,
  IconBug,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { badgeLabel } from '@/lib/notification-badges';
import { notificationsApi } from '@/lib/api';
import {
  NOTIFICATION_LIST_KEY,
  NOTIFICATION_SUMMARY_KEY,
  useNotificationSummary,
} from '@/hooks/use-notification-summary';
import type { AppNotification, NotificationType } from '@/types';

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
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

/** How many rows the panel loads. Older ones live on the notifications screen. */
const PAGE_SIZE = 15;

export function NotificationCenter() {
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const summary = useNotificationSummary();

  // Fetched only while the panel is open. The bell's count comes from the
  // summary, so there is no reason to hold a list of rows nobody is looking at.
  const list = useQuery({
    queryKey: [...NOTIFICATION_LIST_KEY, PAGE_SIZE],
    queryFn: () => notificationsApi.list({ limit: PAGE_SIZE }),
    enabled: open,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LIST_KEY });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  const unread = summary.isReady ? summary.totalUnread : 0;
  const items = list.data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <IconBell className="size-4.5" />
          {unread > 0 && (
            /*
             * A count, not a pulse. The requirement is that a live arrival is
             * noticeable without being theatrical: the number changing in place
             * is enough, and a glow or a bounce in a security dashboard is
             * movement in the corner of the eye of somebody concentrating on
             * something else.
             */
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center',
                'rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums',
                'bg-primary text-primary-foreground ring-2 ring-background',
              )}
            >
              {badgeLabel(unread)}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-foreground">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <IconCheck className="mr-1 size-3.5" />
              Mark all as read
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[420px]">
          {list.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <IconBell className="mx-auto size-6 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">You&apos;re all caught up</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onOpen={() => {
                    // Opening a notification reads it. Marking read only on the
                    // explicit button would leave the bell lit after the user
                    // had plainly acted on the item.
                    if (!notification.read) markRead.mutate(notification.id);
                    setOpen(false);
                  }}
                  onMarkRead={() => markRead.mutate(notification.id)}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onMarkRead,
}: {
  notification: AppNotification;
  onOpen: () => void;
  onMarkRead: () => void;
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
          {relativeTime(notification.createdAt)}
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
