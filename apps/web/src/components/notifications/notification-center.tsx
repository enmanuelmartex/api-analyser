'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { IconArrowRight, IconBell, IconCheck } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { badgeLabel } from '@/lib/notification-badges';
import { notificationsApi } from '@/lib/api';
import {
  NOTIFICATION_LIST_KEY,
  useNotificationActions,
  useNotificationSummary,
} from '@/hooks/use-notification-summary';
import { NotificationRow } from './notification-item';

/**
 * How many rows the panel holds.
 *
 * A preview, not an archive. The panel used to load fifteen and clip whatever
 * did not fit — no scrollbar, no indication there was more, and no way to reach
 * the rest. Everything older now lives on `/notifications`, which the footer
 * links to, so this number only has to be "enough to see what just happened".
 */
const RECENT_LIMIT = 8;

export function NotificationCenter() {
  const [open, setOpen] = React.useState(false);
  const summary = useNotificationSummary();
  const { markRead, markAllRead } = useNotificationActions();

  // Fetched only while the panel is open. The bell's count comes from the
  // summary, so there is no reason to hold a list of rows nobody is looking at.
  const list = useQuery({
    queryKey: [...NOTIFICATION_LIST_KEY, 'recent', RECENT_LIMIT],
    queryFn: () => notificationsApi.list({ limit: RECENT_LIMIT }),
    enabled: open,
  });

  const unread = summary.isReady ? summary.totalUnread : 0;
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const older = Math.max(0, total - items.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          {/* 18px. Not `size-4.5`: Tailwind v3 has no 4.5 in its spacing scale,
              so that compiled to nothing and the bell fell back to the icon
              set's own 24px, filling the 32px button. */}
          <IconBell className="size-[1.125rem]" />
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
                // Equal height and floor width, so a single digit is a circle.
                // Smaller than the sidebar's badge because it overlays a 32px
                // button rather than sitting in a row of its own.
                'absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center',
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

        {/*
          The cap goes on the viewport, not on this element. A `max-h` on the
          root leaves the viewport's `h-full` resolving against an indefinite
          height — it grows to its content, never overflows, and the root's
          `overflow-hidden` clips the rest with no scrollbar. That is the bug
          this panel had: five rows visible, three unreachable.
        */}
        <ScrollArea viewportClassName="max-h-[24rem]">
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

        {/*
          Always present, including on an empty panel: it is the only route to
          the history, and "nothing recent" is exactly when someone wants to look
          further back. The count is what tells them there is something there.
        */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
          <span className="pl-2 text-xs text-muted-foreground">
            {older > 0 ? `${older} more` : 'Recent activity'}
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              View all
              <IconArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
