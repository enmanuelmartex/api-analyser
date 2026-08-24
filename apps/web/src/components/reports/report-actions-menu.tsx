'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconLoader2,
  IconRefresh,
  IconTrash,
  IconActivity,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { reportsApi } from '@/lib/api';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { Report } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Row actions for a report.
 *
 * "Download" and "Regenerate" are separate entries because they are separate
 * operations: the first replays the stored artifact and creates nothing, the
 * second deliberately issues a new version. Download is disabled — never
 * silently turned into a generation — when no artifact exists.
 */
export function ReportActionsMenu({
  report,
  onDelete,
}: {
  report: Report;
  onDelete?: (_report: Report) => void;
}) {
  const { canWrite } = useCurrentUser();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const download = useMutation({
    mutationFn: () => reportsApi.download(report.id),
    onMutate: () => setDownloading(true),
    onError: () => toast.error('The existing report could not be downloaded.'),
    onSettled: () => setDownloading(false),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      reportsApi.generate(report.assessmentId, report.format, report.type, { regenerate: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      toast.success('A new report version was generated');
    },
    onError: () => toast.error('Report generation failed.'),
  });

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Actions for ${report.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <IconDotsVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Report actions</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem asChild>
          <Link href={`/reports/${report.id}`} className="flex items-center gap-2">
            <IconEye className="h-3.5 w-3.5" />
            Open report
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!report.isDownloadable || downloading}
          onSelect={(event) => {
            event.preventDefault();
            download.mutate();
          }}
        >
          {downloading ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconDownload className="h-3.5 w-3.5" />
          )}
          {downloading ? 'Preparing…' : `Download ${report.format}`}
        </DropdownMenuItem>

        {canWrite && (
          <DropdownMenuItem
            disabled={regenerate.isPending}
            onSelect={(event) => {
              event.preventDefault();
              regenerate.mutate();
            }}
          >
            {regenerate.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconRefresh className="h-3.5 w-3.5" />
            )}
            Regenerate
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={`/assessments/${report.assessmentId}`} className="flex items-center gap-2">
            <IconActivity className="h-3.5 w-3.5" />
            View assessment
          </Link>
        </DropdownMenuItem>

        {onDelete && canWrite && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(report)}>
              <IconTrash className="h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
