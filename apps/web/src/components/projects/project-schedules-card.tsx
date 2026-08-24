'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { IconCalendarClock, IconPlus } from '@tabler/icons-react';
import { scheduledScansApi } from '@/lib/api';
import type { Paginated, Project, ScheduledScan } from '@/types';
import { formatCountdown, formatInZone, nextRunLabel } from '@/lib/schedule-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ScheduleStatusBadge } from '@/components/scheduled-scans/schedule-status-badge';
import { ScheduleActions } from '@/components/scheduled-scans/schedule-actions';
import { ScheduleSheet } from '@/components/scheduled-scans/schedule-sheet';
import { useCurrentUser } from '@/hooks/use-current-user';

/**
 * This project's automatic scans, on the project page.
 *
 * Scoped to the project rather than listing everything: someone looking at the
 * Payment API wants to know what is scheduled against the Payment API. The
 * "View all" path is the Scheduled Scans screen, which the empty state links to
 * implicitly by way of the same create sheet.
 */
export function ProjectSchedulesCard({ project }: { project: Project }) {
  const { canWrite } = useCurrentUser();
  const { data, isLoading, isError } = useQuery<Paginated<ScheduledScan>>({
    queryKey: ['scheduled-scans', 'list', { projectId: project.id }],
    queryFn: () => scheduledScansApi.list({ projectId: project.id, pageSize: 5 }),
    enabled: Boolean(project.id),
  });

  const schedules = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <IconCalendarClock className="size-4 text-primary" />
              Scheduled scans
            </CardTitle>
            <CardDescription>
              Assessments that run automatically against this API.
            </CardDescription>
          </div>
          {schedules.length > 0 && canWrite && (
            <ScheduleSheet
              project={project}
              trigger={
                <Button variant="outline" size="sm">
                  <IconPlus className="size-4" />
                  Add
                </Button>
              }
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-[58px] w-full rounded-md" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={IconCalendarClock}
            title="Could not load schedules"
            description="Try again in a moment."
            compact
          />
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={IconCalendarClock}
            title="No scheduled scans"
            description="Set this API to be scanned automatically, so a regression is caught without anyone having to remember."
            compact
            action={
              canWrite ? (
                <ScheduleSheet
                  project={project}
                  trigger={
                    <Button size="sm" variant="outline" disabled={project.status !== 'READY'}>
                      <IconCalendarClock className="size-4" />
                      Schedule Scan
                    </Button>
                  }
                />
              ) : undefined
            }
          />
        ) : (
          <>
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <Link
                    href={`/scheduled-scans/${schedule.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {schedule.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{schedule.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="hidden text-right sm:block">
                    <p className="text-xs tabular-nums">
                      {nextRunLabel(schedule.nextRunAt, schedule.displayStatus, schedule.timezone)}
                    </p>
                    {schedule.nextRunAt && schedule.displayStatus !== 'PAUSED' && (
                      <p className="text-xs text-muted-foreground">
                        {formatCountdown(schedule.nextRunAt)}
                      </p>
                    )}
                  </div>
                  <ScheduleStatusBadge status={schedule.displayStatus} />
                  <ScheduleActions schedule={schedule} />
                </div>
              </div>
            ))}

            {data && data.total > schedules.length && (
              <Link
                href={`/scheduled-scans?projectId=${project.id}`}
                className="block pt-1 text-xs font-medium text-primary hover:underline"
              >
                View all {data.total} schedules →
              </Link>
            )}

            {/* Named next to the runs so "when does this next scan?" and "what
                does the schedule say?" are answered in the same place. */}
            {schedules[0]?.lastRunAt && (
              <p className="pt-1 text-xs text-muted-foreground">
                Last automatic run{' '}
                {formatInZone(schedules[0].lastRunAt, schedules[0].timezone)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
