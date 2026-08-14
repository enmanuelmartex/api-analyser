'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { IconArrowLeft, IconCalendarClock, IconExternalLink } from '@tabler/icons-react';
import { scheduledScansApi } from '@/lib/api';
import type { Paginated, ScheduleExecution, ScheduledScan } from '@/types';
import { FREQUENCY_LABELS, formatCountdown, formatInZone } from '@/lib/schedule-list';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ExecutionStatusBadge,
  ScheduleStatusBadge,
} from '@/components/scheduled-scans/schedule-status-badge';
import { ScheduleActions } from '@/components/scheduled-scans/schedule-actions';
import { formatDuration } from '@/lib/utils';

const EXECUTIONS_PAGE_SIZE = 10;

/**
 * One schedule: what it will do, and what it has done.
 *
 * The execution table is the bridge the whole feature is built around — every
 * row that produced a scan links to that scan, and from there to its findings
 * and reports. A row that produced nothing says why instead of being absent.
 */
export default function ScheduledScanDetailPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const router = useRouter();
  const [page, setPage] = useState(1);

  const {
    data: schedule,
    isLoading,
    isError,
  } = useQuery<ScheduledScan>({
    queryKey: ['scheduled-scans', scheduleId],
    queryFn: () => scheduledScansApi.get(scheduleId),
    enabled: Boolean(scheduleId),
    refetchInterval: 30_000,
  });

  const executionsQuery = useQuery<Paginated<ScheduleExecution>>({
    queryKey: ['scheduled-scans', scheduleId, 'executions', page],
    queryFn: () => scheduledScansApi.executions(scheduleId, page, EXECUTIONS_PAGE_SIZE),
    enabled: Boolean(scheduleId),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-6 h-48 w-full" />
        <Skeleton className="mt-4 h-72 w-full" />
      </PageContainer>
    );
  }

  if (isError || !schedule) {
    return (
      <PageContainer>
        <EmptyState
          icon={IconCalendarClock}
          title="Scheduled scan not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <Button asChild variant="outline">
              <Link href="/scheduled-scans">Back to scheduled scans</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const executions = executionsQuery.data?.data ?? [];
  const executionsData = executionsQuery.data;

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={schedule.name}
        description={`${schedule.description} · ${schedule.timezone} (${schedule.timezoneOffset})`}
        breadcrumb={
          <Link
            href="/scheduled-scans"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-3" />
            Scheduled scans
          </Link>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/projects/${schedule.projectId}`}>
                <IconExternalLink className="size-4" />
                Open project
              </Link>
            </Button>
            <ScheduleActions schedule={schedule} onDeleted={() => router.push('/scheduled-scans')} />
          </>
        }
      />

      {/* ── What it is ────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="grid gap-x-8 gap-y-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Status">
            <ScheduleStatusBadge status={schedule.displayStatus} />
          </Detail>
          <Detail label="Project">
            <Link href={`/projects/${schedule.projectId}`} className="text-sm hover:underline">
              {schedule.project.name}
            </Link>
          </Detail>
          <Detail label="Frequency">
            <span className="text-sm">{FREQUENCY_LABELS[schedule.frequency]}</span>
          </Detail>
          <Detail label="Schedule">
            <span className="text-sm">{schedule.description}</span>
          </Detail>
          <Detail label="Timezone">
            {/* Never presented as UTC: the operator configured a wall-clock
                time in this zone, and this is the zone it will run in. */}
            <span className="text-sm">
              {schedule.timezone}{' '}
              <span className="text-muted-foreground">({schedule.timezoneOffset})</span>
            </span>
          </Detail>
          <Detail label="Scan configuration">
            <span className="text-sm">
              {schedule.executionMode === 'profile'
                ? (schedule.scanProfile?.name ?? 'Scan profile')
                : schedule.executionMode === 'manual'
                  ? `${schedule.manualPlugins.length} selected check${schedule.manualPlugins.length === 1 ? '' : 's'}`
                  : 'All enabled checks'}
            </span>
          </Detail>
          <Detail label="Next run">
            {schedule.status === 'PAUSED' ? (
              <span className="text-sm text-muted-foreground">Paused</span>
            ) : schedule.nextRunAt ? (
              <span className="text-sm">
                {formatInZone(schedule.nextRunAt, schedule.timezone, { weekday: 'short' })}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatCountdown(schedule.nextRunAt)}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </Detail>
          <Detail label="Last run">
            <span className="text-sm">
              {schedule.lastRunAt
                ? formatInZone(schedule.lastRunAt, schedule.timezone, { weekday: 'short' })
                : 'Never'}
            </span>
          </Detail>
          <Detail label="Total runs">
            <span className="text-sm tabular-nums">{schedule.totalRuns}</span>
          </Detail>
        </CardContent>
      </Card>

      {/*
        A schedule that keeps failing to START is invisible otherwise: no scan
        is created, so nothing appears in the scans list to notice.
      */}
      {schedule.consecutiveFailures > 0 && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          The last {schedule.consecutiveFailures} attempt
          {schedule.consecutiveFailures === 1 ? '' : 's'} to start a scan failed. The schedule is
          still active and will try again at its next run.
        </p>
      )}

      {/* ── Upcoming ──────────────────────────────────────────────────── */}
      {schedule.upcomingRuns && schedule.upcomingRuns.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upcoming runs</CardTitle>
            <CardDescription>
              The next occurrences of this rule, in {schedule.timezone}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {schedule.upcomingRuns.map((run) => (
                <li
                  key={run}
                  className="rounded-md border bg-muted/30 px-2.5 py-1 text-xs tabular-nums"
                >
                  {formatInZone(run, schedule.timezone, { weekday: 'short' })}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── What it has done ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution history</CardTitle>
          <CardDescription>
            Every occurrence this schedule reached — including the ones it deliberately skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {executionsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : executions.length === 0 ? (
            <EmptyState
              icon={IconCalendarClock}
              title="No runs yet"
              description={
                schedule.nextRunAt
                  ? `The first run is ${formatInZone(schedule.nextRunAt, schedule.timezone)}.`
                  : 'This schedule has not run.'
              }
              compact
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead className="hidden sm:table-cell">Duration</TableHead>
                    <TableHead className="hidden md:table-cell">Score</TableHead>
                    <TableHead className="hidden md:table-cell">Findings</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Scan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.map((execution) => {
                    const summary = execution.assessment?.summary;
                    return (
                      <TableRow key={execution.id}>
                        <TableCell>
                          <span className="text-sm">
                            {formatInZone(
                              execution.startedAt ?? execution.scheduledFor,
                              schedule.timezone,
                            )}
                          </span>
                          {/* A run dispatched late after an outage keeps its
                              planned occurrence, which is what makes the
                              lateness visible rather than invisible. */}
                          {execution.startedAt &&
                            Math.abs(
                              new Date(execution.startedAt).getTime() -
                                new Date(execution.scheduledFor).getTime(),
                            ) >
                              5 * 60_000 && (
                              <p className="text-xs text-muted-foreground">
                                planned {formatInZone(execution.scheduledFor, schedule.timezone)}
                              </p>
                            )}
                          {execution.trigger === 'MANUAL' && (
                            <p className="text-xs text-muted-foreground">run manually</p>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {execution.assessment?.duration
                            ? formatDuration(execution.assessment.duration)
                            : '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm tabular-nums">
                          {summary?.securityScore != null && summary.scoreStatus !== 'UNAVAILABLE'
                            ? `${Math.round(summary.securityScore)}/100`
                            : '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm tabular-nums">
                          {summary ? (
                            <span>
                              {summary.totalFindings}
                              {summary.criticalCount > 0 && (
                                <span className="ml-1.5 text-xs text-severity-critical">
                                  {summary.criticalCount} critical
                                </span>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <ExecutionStatusBadge status={execution.status} />
                          {execution.reason && (
                            <p
                              className="mt-1 max-w-56 truncate text-xs text-muted-foreground"
                              title={execution.reason}
                            >
                              {execution.reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {execution.assessmentId ? (
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/assessments/${execution.assessmentId}`}>Open</Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">No scan</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {executionsData && executionsData.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
              <span>
                Page {executionsData.page} of {executionsData.totalPages} · {executionsData.total}{' '}
                run{executionsData.total === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={executionsData.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={executionsData.page >= executionsData.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
