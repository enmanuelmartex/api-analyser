'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { IconActivity, IconArrowLeft, IconBraces, IconExternalLink, IconWorld } from '@tabler/icons-react';
import { assessmentsApi, projectsApi } from '@/lib/api';
import type { Assessment, Paginated, Project } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { RunAssessmentSheet } from '@/components/projects/run-assessment-sheet';
import { getHttpMethodStyles } from '@/lib/http-method-styles';
import { cn } from '@/lib/utils';

const ASSESSMENTS_PAGE_SIZE = 5;

export default function ProjectDetailsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const projectsQuery = searchParams.get('projectsQuery');
  const projectsHref = projectsQuery ? `/projects?${projectsQuery}` : '/projects';
  const { data: project, isLoading, isError } = useQuery<Project>({
    queryKey: ['projects', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: Boolean(projectId),
  });

  // Server-side paginated scans for this project, newest first. Reset to the
  // first page whenever the open project changes.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [projectId]);

  const assessmentsQuery = useQuery<Paginated<Assessment>>({
    queryKey: ['assessments', 'project', projectId, page],
    queryFn: () => assessmentsApi.listByProject(projectId, page, ASSESSMENTS_PAGE_SIZE),
    enabled: Boolean(projectId),
    // Keep the current page visible while the next one loads, so paging never
    // flashes an empty card or reloads the whole route.
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <PageContainer><Skeleton className="h-9 w-64" /><Skeleton className="mt-6 h-72 w-full" /></PageContainer>;
  if (isError || !project) return <PageContainer><EmptyState icon={IconWorld} title="Project not found" description="The project may have been deleted or you may not have access to it." action={<Button asChild variant="outline"><Link href="/projects">Back to projects</Link></Button>} /></PageContainer>;

  const endpoints = project.apiSpec?.endpoints ?? [];
  const assessments = project.assessments ?? [];
  const assessmentsData = assessmentsQuery.data;
  const recentAssessments = assessmentsData?.data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={project.name || 'Untitled project'}
        description={project.description || project.baseUrl}
        breadcrumb={<Link href={projectsHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconArrowLeft className="size-3" />Projects</Link>}
        actions={<><Button asChild variant="outline"><a href={project.baseUrl} target="_blank" rel="noreferrer"><IconExternalLink />Open API</a></Button><RunAssessmentSheet project={project} /></>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardDescription>Environment</CardDescription><CardTitle>{project.environment}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>API specification</CardDescription><CardTitle>{project.apiSpec?.title || 'OpenAPI'}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Version {project.apiSpec?.version || 'not specified'}</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Coverage</CardDescription><CardTitle>{endpoints.length} endpoints</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{assessments.length} recent assessments</p></CardContent></Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><IconBraces className="size-4 text-primary" />Endpoints</CardTitle><CardDescription>Operations imported from the current API specification.</CardDescription></CardHeader>
          <CardContent className="space-y-2">{endpoints.length ? endpoints.slice(0, 12).map((endpoint) => <div key={endpoint.id} className="flex min-w-0 items-center gap-3 rounded-md border p-2.5"><Badge variant="outline" className={`w-16 justify-center font-mono text-[10px] ${getHttpMethodStyles(endpoint.method)}`}>{endpoint.method}</Badge><span className="truncate font-mono text-xs">{endpoint.path}</span></div>) : <p className="text-sm text-muted-foreground">No endpoints were imported.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><IconActivity className="size-4 text-primary" />Recent assessments</CardTitle><CardDescription>Latest security scans for this project.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {assessmentsQuery.isLoading ? (
              <div className="space-y-2">{Array.from({ length: ASSESSMENTS_PAGE_SIZE }).map((_, i) => <Skeleton key={i} className="h-[50px] w-full rounded-md" />)}</div>
            ) : assessmentsQuery.isError ? (
              <EmptyState icon={IconActivity} title="Could not load assessments" description="Try again in a moment." compact />
            ) : recentAssessments.length ? (
              <div className={cn('space-y-2 transition-opacity', assessmentsQuery.isFetching && 'opacity-60')}>
                {recentAssessments.map((assessment) => <Link key={assessment.id} href={`/assessments/${assessment.id}`} className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"><span className="text-sm">{new Date(assessment.createdAt).toLocaleDateString()}</span><Badge variant="outline">{assessment.status}</Badge></Link>)}
              </div>
            ) : (
              <EmptyState icon={IconActivity} title="No assessments yet" compact />
            )}
            {assessmentsData && assessmentsData.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                <span>Page {assessmentsData.page} of {assessmentsData.totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={assessmentsData.page <= 1 || assessmentsQuery.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={assessmentsData.page >= assessmentsData.totalPages || assessmentsQuery.isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
