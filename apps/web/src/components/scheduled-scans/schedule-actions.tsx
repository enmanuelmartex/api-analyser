'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  IconDotsVertical,
  IconEdit,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconTrash,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { scheduledScansApi } from '@/lib/api';
import type { ScheduledScan } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeleteConfirmationDialog } from '@/components/shared/delete-confirmation-dialog';
import { ScheduleSheet } from './schedule-sheet';

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message ?? error.response?.data?.error;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/**
 * Run now, edit, pause/resume and delete for one schedule.
 *
 * Every action is a real call to the API — none of these buttons is decorative.
 * Two of them carry a promise that is easy to break and is therefore stated in
 * the UI as well as enforced on the server:
 *
 *  - "Run now" does not move the next automatic run.
 *  - Deleting the schedule does not delete the scans it produced.
 */
export function ScheduleActions({
  schedule,
  onDeleted,
}: {
  schedule: ScheduledScan;
  /** Where to go after deletion. The list stays put; the detail page leaves. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['scheduled-scans'] });

  const runNow = useMutation({
    mutationFn: () => scheduledScansApi.run(schedule.id),
    onSuccess: (result) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
      toast.success('Scan started', {
        description: 'The next automatic run is unchanged.',
        action: {
          label: 'Open scan',
          onClick: () => router.push(`/assessments/${result.assessmentId}`),
        },
      });
    },
    onError: (error) =>
      toast.error('The scan could not be started', {
        description: errorMessage(error, 'Try again in a moment.'),
      }),
  });

  const pause = useMutation({
    mutationFn: () => scheduledScansApi.pause(schedule.id),
    onSuccess: () => {
      refresh();
      toast.success('Schedule paused', { description: 'No further runs until it is resumed.' });
    },
    onError: (error) => toast.error('Could not pause', { description: errorMessage(error, '') }),
  });

  const resume = useMutation({
    mutationFn: () => scheduledScansApi.resume(schedule.id),
    onSuccess: (updated) => {
      refresh();
      toast.success('Schedule resumed', {
        // Says explicitly that the missed window is not replayed — the question
        // every operator has when resuming something paused for weeks.
        description: updated.nextRunAt
          ? `Next run ${new Date(updated.nextRunAt).toLocaleString()}. Missed runs are not replayed.`
          : undefined,
      });
    },
    onError: (error) =>
      toast.error('Could not resume', {
        description: errorMessage(error, 'Edit the schedule and try again.'),
      }),
  });

  const remove = useMutation({
    mutationFn: () => scheduledScansApi.remove(schedule.id),
    onSuccess: (result) => {
      refresh();
      setDeleteOpen(false);
      toast.success('Schedule deleted', {
        description: `${result.assessmentsKept} scan${result.assessmentsKept === 1 ? '' : 's'} it produced ${result.assessmentsKept === 1 ? 'was' : 'were'} kept.`,
      });
      onDeleted?.();
    },
    onError: (error) => toast.error('Could not delete', { description: errorMessage(error, '') }),
  });

  const isPaused = schedule.status === 'PAUSED';
  const busy = runNow.isPending || pause.isPending || resume.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${schedule.name}`}
            disabled={busy}
          >
            <IconDotsVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => runNow.mutate()}>
            <IconPlayerTrackNext className="size-4" />
            Run now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <IconEdit className="size-4" />
            Edit
          </DropdownMenuItem>
          {isPaused ? (
            <DropdownMenuItem onSelect={() => resume.mutate()}>
              <IconPlayerPlay className="size-4" />
              Resume
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => pause.mutate()}>
              <IconPlayerPause className="size-4" />
              Pause
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <IconTrash className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rendered outside the menu: a dialog inside a menu unmounts with it. */}
      <ScheduleSheet schedule={schedule} open={editOpen} onOpenChange={setEditOpen} />

      <DeleteConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        isDeleting={remove.isPending}
        title={`Delete "${schedule.name}"?`}
        description="No further scans will be scheduled. The scans this schedule already produced — and their findings and reports — are kept."
        confirmLabel="Delete schedule"
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
