'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { IconArrowRight, IconCalendarClock } from '@tabler/icons-react';
import { scheduledScansApi } from '@/lib/api';
import type { UpcomingScheduledScan } from '@/types';
import { formatCountdown, formatInZone } from '@/lib/schedule-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Deliberately few. This is a glance, not a second Scheduled Scans page. */
const LIMIT = 4;

/**
 * The next few automatic scans, on the dashboard.
 *
 * Compact on purpose: it answers "is anything about to scan?" and then gets out
 * of the way. Anything more belongs on the Scheduled Scans screen, which the
 * footer links to.
 *
 * Renders nothing at all when there are no schedules — an empty card
 * advertising a feature is noise on a screen whose job is the security posture.
 */
export function UpcomingScansCard() {
  const { data, isLoading } = useQuery<UpcomingScheduledScan[]>({
    queryKey: ['scheduled-scans', 'upcoming'],
    queryFn: () => scheduledScansApi.upcoming(LIMIT),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-56 rounded-xl" />;
  if (!data || data.length === 0) return null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconCalendarClock className="size-4 text-primary" />
          Upcoming scheduled scans
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        <ul className="space-y-1">
          {data.map((scan) => (
            <li key={scan.id}>
              <Link
                href={`/scheduled-scans/${scan.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{scan.projectName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{scan.name}</span>
                </span>
                <span className="shrink-0 text-right">
                  {/* In the SCHEDULE's timezone, not the browser's — the time
                      the operator configured is the time they should read. */}
                  <span className="block text-sm tabular-nums">
                    {formatInZone(scan.nextRunAt, scan.timezone, {
                      year: undefined,
                      weekday: 'short',
                    })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatCountdown(scan.nextRunAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/scheduled-scans"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View all schedules
          <IconArrowRight className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
