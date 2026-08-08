'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { IconFileAnalytics, IconFolder, IconTrash } from '@tabler/icons-react';
import { toast } from 'sonner';
import { reportsApi } from '@/lib/api';
import { cn, formatBytes, formatDate, formatRelative } from '@/lib/utils';
import type { Report } from '@/types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { ReportActionsMenu } from '@/components/reports/report-actions-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Reports opens on five rows. Other tables keep the app-wide default of 20. */
export const REPORTS_PAGE_SIZE = 5;
export const REPORTS_PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

const FORMAT_TONE: Record<string, string> = {
  PDF: 'border-destructive/20 bg-destructive/10 text-destructive',
  HTML: 'border-chart-2/20 bg-chart-2/10 text-chart-2',
  JSON: 'border-severity-medium/20 bg-severity-medium/10 text-severity-medium',
  SARIF: 'border-chart-3/20 bg-chart-3/10 text-chart-3',
  MARKDOWN: 'border-border bg-muted text-muted-foreground',
};

const TYPE_LABELS: Record<string, string> = {
  EXECUTIVE: 'Executive',
  TECHNICAL: 'Technical',
  COMPLIANCE: 'Compliance',
  DEVELOPER: 'Developer',
};

export function ReportsTable({
  reports,
  isLoading,
  hideProjectColumn = false,
  emptyState,
  toolbarFilters,
}: {
  reports: Report[];
  isLoading?: boolean;
  hideProjectColumn?: boolean;
  emptyState?: React.ReactNode;
  toolbarFilters?: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      toast.success('Report deleted');
      setDeleteTarget(null);
    },
    onError: () => toast.error('The report could not be deleted.'),
  });

  const columns = useMemo<ColumnDef<Report>[]>(() => {
    const result: ColumnDef<Report>[] = [
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Report" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.original.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {/* Secondary, never the headline: an id is not a report name. */}
              <span className="font-mono">{row.original.id.slice(0, 8)}</span>
              {row.original.version > 1 && ` · v${row.original.version}`}
              {row.original.fileSize ? ` · ${formatBytes(row.original.fileSize)}` : ''}
            </p>
          </div>
        ),
      },
      {
        id: 'assessment',
        meta: { className: 'hidden xl:table-cell' },
        accessorFn: (report) => report.assessmentId,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Assessment" />,
        cell: ({ row }) => (
          <Link
            href={`/assessments/${row.original.assessmentId}`}
            onClick={(event) => event.stopPropagation()}
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {row.original.assessmentId.slice(0, 8)}
          </Link>
        ),
        size: 110,
      },
      {
        accessorKey: 'format',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Format" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-[10px] font-bold uppercase tracking-wider',
                FORMAT_TONE[row.original.format],
              )}
            >
              {row.original.format}
            </Badge>
            {!row.original.isDownloadable && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                no file
              </span>
            )}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: 'type',
        meta: { className: 'hidden md:table-cell' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {TYPE_LABELS[row.original.type] ?? row.original.type}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'generatedAt',
        meta: { className: 'hidden lg:table-cell' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Generated" />,
        cell: ({ row }) => (
          <div>
            <p className="text-xs text-foreground">{formatRelative(row.original.generatedAt)}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatDate(row.original.generatedAt).split(',')[0]}
            </p>
          </div>
        ),
        size: 130,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="text-right">
            <ReportActionsMenu report={row.original} onDelete={setDeleteTarget} />
          </div>
        ),
        size: 50,
      },
    ];

    if (!hideProjectColumn) {
      result.splice(1, 0, {
        id: 'project',
        meta: { className: 'hidden lg:table-cell' },
        accessorFn: (report) => report.assessment?.project?.name ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) =>
          row.original.assessment?.project ? (
            <Link
              href={`/projects/${row.original.assessment.project.id}`}
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconFolder className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.original.assessment.project.name}</span>
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      });
    }

    return result;
  }, [hideProjectColumn]);

  return (
    <>
      <DataTable
        columns={columns}
        data={reports}
        isLoading={isLoading}
        getRowId={(report) => report.id}
        onRowClick={(report) => router.push(`/reports/${report.id}`)}
        searchPlaceholder="Search reports, projects or assessments…"
        pageSize={REPORTS_PAGE_SIZE}
        pageSizeOptions={REPORTS_PAGE_SIZE_OPTIONS}
        toolbarFilters={toolbarFilters}
        emptyState={
          emptyState ?? (
            <EmptyState
              icon={IconFileAnalytics}
              title="No reports yet"
              description="Run a security scan to generate your first report."
              compact
            />
          )
        }
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <IconTrash />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {deleteTarget?.title ? `Delete “${deleteTarget.title}”?` : 'Delete report?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This report and its stored file will be permanently deleted. The assessment and its
              findings are not affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) remove.mutate(deleteTarget.id);
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
