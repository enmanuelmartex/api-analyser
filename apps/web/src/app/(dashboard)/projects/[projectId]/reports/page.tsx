'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconFileAnalytics } from '@tabler/icons-react';
import { reportsApi } from '@/lib/api';
import type { Report } from '@/types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ReportsTable } from '@/components/reports/reports-table';

export default function ProjectReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const reports = useQuery<Report[]>({ queryKey: ['reports'], queryFn: () => reportsApi.list() });
  const projectReports = (reports.data ?? []).filter(
    (report) => report.assessment?.project?.id === projectId,
  );

  if (reports.isError) {
    return (
      <EmptyState
        icon={IconAlertTriangle}
        title="Unable to load reports"
        description="The reports service could not be reached."
        action={
          <Button variant="outline" size="sm" onClick={() => reports.refetch()}>
            Retry
          </Button>
        }
        compact
      />
    );
  }

  return (
    <ReportsTable
      reports={projectReports}
      isLoading={reports.isLoading}
      hideProjectColumn
      emptyState={
        <EmptyState
          icon={IconFileAnalytics}
          title="No reports yet"
          description="Run a security scan to generate your first report."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}`}>Back to project</Link>
            </Button>
          }
          compact
        />
      }
    />
  );
}
