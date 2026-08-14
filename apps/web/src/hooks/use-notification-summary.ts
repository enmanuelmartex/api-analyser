'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { applySectionRead } from '@/lib/notification-badges';
import type { AppNotification, NotificationSection, NotificationSummary } from '@/types';

/**
 * The query key every consumer of unread counts shares.
 *
 * Exported so a mutation elsewhere can invalidate it without importing the hook
 * and without inventing a second key that would only invalidate half the UI.
 */
export const NOTIFICATION_SUMMARY_KEY = ['notifications', 'summary'] as const;
export const NOTIFICATION_LIST_KEY = ['notifications', 'list'] as const;

const EMPTY_SUMMARY: NotificationSummary = {
  totalUnread: 0,
  byCategory: {},
  scans: 0,
  issues: 0,
  reports: 0,
};

/**
 * The single source of unread counts for the whole application.
 *
 * The sidebar badges, the header bell and the notification centre all call this
 * and all get the same cached object, because React Query dedupes by key. The
 * alternative — a request per sidebar item plus one for the bell — is both four
 * times the traffic and a guarantee that the numbers disagree, since each would
 * settle at a different moment.
 *
 * Freshness comes from three places, in order of how quickly they act:
 *
 *   1. The SSE stream (`useNotificationStream`, mounted once in the shell),
 *      which invalidates this key the instant a notification arrives.
 *   2. A refetch when the window regains focus, which covers a laptop that was
 *      asleep while the stream was down.
 *   3. A slow poll, as the backstop for a proxy that silently drops the stream.
 */
export function useNotificationSummary() {
  const query = useQuery({
    queryKey: NOTIFICATION_SUMMARY_KEY,
    queryFn: notificationsApi.summary,
    // The stream is the real update mechanism; this only catches a dropped
    // connection. Two minutes is frequent enough that a badge is never badly
    // stale and rare enough to be invisible in the network log.
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const summary = query.data ?? EMPTY_SUMMARY;

  return {
    ...summary,
    isLoading: query.isLoading,
    /**
     * True once the first response has landed.
     *
     * Badges render only when this is true, so a page load does not flash a
     * count of zero and then pop a number in — which reads as an animation
     * nobody asked for.
     */
    isReady: query.isSuccess,
  };
}

/**
 * Marks one section read, and updates the badge immediately.
 *
 * Optimistic because the user has just navigated to the section: waiting for a
 * round trip means the badge they were looking at stays lit for a moment after
 * they act on it, which reads as the click not registering.
 */
export function useMarkSectionRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (section: NotificationSection) => notificationsApi.markSectionRead(section),

    onMutate: async (section) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
      const previous = queryClient.getQueryData<NotificationSummary>(NOTIFICATION_SUMMARY_KEY);

      if (previous) {
        // The arithmetic — including why the total is decremented rather than
        // recomputed — lives in `applySectionRead`, which is unit-tested.
        queryClient.setQueryData<NotificationSummary>(
          NOTIFICATION_SUMMARY_KEY,
          applySectionRead(previous, section),
        );
      }

      return { previous };
    },

    onError: (_error, _section, context) => {
      // Put the real numbers back. A failed mark-read that left the badge
      // cleared would lose the user's only signal that something is unread.
      if (context?.previous) {
        queryClient.setQueryData(NOTIFICATION_SUMMARY_KEY, context.previous);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LIST_KEY });
    },
  });
}

/**
 * Clears a section's badge when the user actually looks at the section.
 *
 * Fires once per mount rather than on every render, and only when there is
 * something to clear — an unconditional call would write to the database on
 * every navigation to a section with no unread items.
 *
 * "Seen" is deliberately defined as "opened the section". Tracking which
 * individual rows entered the viewport would be more precise and much worse:
 * the badge would linger after the user had plainly looked at the screen.
 */
export function useMarkSectionSeen(section: NotificationSection) {
  const summary = useNotificationSummary();
  const markRead = useMarkSectionRead();
  const done = React.useRef(false);

  const count = summary[section];
  const ready = summary.isReady;

  // `markRead` is deliberately absent from the dependency list: React Query
  // returns a new mutation object each render, so including it would re-run
  // this effect constantly. The ref guard makes the effect fire once regardless.
  const mutate = markRead.mutate;
  const mutateRef = React.useRef(mutate);
  mutateRef.current = mutate;

  React.useEffect(() => {
    // Guarded on the count so navigating to a section with nothing unread does
    // not write to the database on every visit.
    if (done.current || !ready || count <= 0) return;
    done.current = true;
    mutateRef.current(section);
  }, [ready, count, section]);
}

/**
 * Keeps the summary and the notification list live.
 *
 * Mounted exactly once, in the dashboard shell. Every component that needs
 * counts reads the React Query cache this refreshes, so there is one EventSource
 * for the whole application rather than one per badge.
 *
 * The stream is an optimisation, not the source of truth: everything it carries
 * is already a row in the database before it is published. A user who was
 * offline when their 3 a.m. scan finished sees the same counts on their next
 * page load, because they come from the same query either way.
 */
export function useNotificationStream(
  // eslint-disable-next-line no-unused-vars
  options: { onNotification?: (notification: AppNotification) => void } = {},
) {
  const queryClient = useQueryClient();
  const onNotification = options.onNotification;

  // Held in a ref so a changing callback identity does not tear down and
  // re-establish the connection on every render of the shell.
  const handlerRef = React.useRef(onNotification);
  React.useEffect(() => {
    handlerRef.current = onNotification;
  }, [onNotification]);

  React.useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('api_analyser_token') : null;
    if (!token) return;

    const source = notificationsApi.stream(token);

    source.onmessage = (message) => {
      let notification: AppNotification | null = null;
      try {
        notification = JSON.parse(message.data) as AppNotification;
      } catch {
        // A malformed frame is not worth tearing the stream down for. The
        // invalidation below still runs, so the counts stay correct.
      }

      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LIST_KEY });

      if (notification) handlerRef.current?.(notification);
    };

    // No onerror handler that reconnects: EventSource already retries with its
    // own backoff, and reimplementing that on top produces two reconnect loops
    // racing each other.

    return () => source.close();
  }, [queryClient]);
}
