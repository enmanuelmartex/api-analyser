'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { FolderOpen, Plus, SearchX } from 'lucide-react';
import { projectsApi } from '@/lib/api';
import {
  EMPTY_PROJECT_FILTERS,
  filterAndSortProjects,
  getPaginationItems,
  hasActiveProjectFilters,
  parseProjectFilters,
  parseProjectPage,
  serializeProjectFilters,
  type ProjectFilterState,
  type ProjectListItem,
} from '@/lib/project-list';
import type { Project } from '@/types';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { ProjectCard, ProjectCardSkeleton } from '@/components/projects/project-card';
import { ProjectDrawer } from '@/components/projects/project-drawer';
import { ProjectFilters } from '@/components/projects/project-filters';
import { DeleteConfirmationDialog } from '@/components/shared/delete-confirmation-dialog';

/** 12 fills four rows of the three-column desktop grid. */
const PROJECTS_PER_PAGE = 12;

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);

  const { data: projects, isLoading } = useQuery<ProjectListItem[]>({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseProjectFilters(params), [params]);
  const requestedPage = parseProjectPage(params);

  const visibleProjects = useMemo(
    () => filterAndSortProjects(projects ?? [], filters),
    [projects, filters],
  );

  const pageCount = Math.max(1, Math.ceil(visibleProjects.length / PROJECTS_PER_PAGE));
  const currentPage = Math.min(requestedPage, pageCount);
  const paginatedProjects = useMemo(
    () => visibleProjects.slice((currentPage - 1) * PROJECTS_PER_PAGE, currentPage * PROJECTS_PER_PAGE),
    [visibleProjects, currentPage],
  );

  const replaceQuery = useCallback(
    (query: string) => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    [pathname, router],
  );

  // A shrinking result set can leave the URL pointing past the last page.
  useEffect(() => {
    if (isLoading || requestedPage === currentPage) return;
    replaceQuery(serializeProjectFilters(filters, currentPage));
  }, [isLoading, requestedPage, currentPage, filters, replaceQuery]);

  const applyFilters = useCallback(
    (next: ProjectFilterState) => replaceQuery(serializeProjectFilters(next)),
    [replaceQuery],
  );

  function goToPage(page: number) {
    const target = Math.min(Math.max(page, 1), pageCount);
    replaceQuery(serializeProjectFilters(filters, target));
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      /*
       * The backend now hard-deletes a project's scans, findings, reports and
       * scheduled scans along with it (previously a soft delete, so this
       * cache was never stale in the same way). Invalidating only `projects`
       * left every other screen — Assessments, Issues, Reports, the
       * dashboard, Scheduled Scans — showing rows for a project that no
       * longer exists in the database until a full page reload happened to
       * refetch them. Every query domain that can reference a project (or an
       * assessment, which just vanished with it) needs invalidating here.
       */
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      void queryClient.invalidateQueries({ queryKey: ['assessment-score'] });
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      void queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['scheduled-scans'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Proyecto eliminado');
    },
    onError: () => toast.error('No se pudo eliminar el proyecto'),
  });

  function createProject() {
    setEditing(null);
    setDrawerOpen(true);
  }

  /** The list payload omits the spec and auth config, so the drawer needs the full record. */
  async function openProject(project: ProjectListItem) {
    try {
      setEditing(await projectsApi.get(project.id));
      setDrawerOpen(true);
    } catch {
      toast.error('No se pudo cargar el proyecto. Inténtalo de nuevo.');
    }
  }

  const hasProjects = Boolean(projects?.length);
  const filtersActive = hasActiveProjectFilters(filters);
  const hasDrafts = useMemo(() => (projects ?? []).some((project) => project.status === 'DRAFT'), [projects]);

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description="Manage your API security assessment projects"
        actions={
          <Button onClick={createProject}>
            <Plus className="size-4" />
            Nuevo proyecto
          </Button>
        }
      />

      {(hasProjects || filtersActive) && !isLoading && (
        <ProjectFilters value={filters} onChange={applyFilters} hasDrafts={hasDrafts} className="mb-5" />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      ) : !hasProjects ? (
        <EmptyPanel
          icon={FolderOpen}
          title="No projects yet"
          description="Create your first project to import an OpenAPI specification and run a security scan."
          action={
            <Button onClick={createProject}>
              <Plus className="size-4" />
              Crear primer proyecto
            </Button>
          }
        />
      ) : !visibleProjects.length ? (
        <EmptyPanel
          icon={SearchX}
          title="Sin resultados"
          description="Ningún proyecto coincide con los filtros aplicados. Prueba con otros términos o límpialos."
          action={
            <Button variant="outline" onClick={() => applyFilters(EMPTY_PROJECT_FILTERS)}>
              Limpiar filtros
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {paginatedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              href={`/projects/${project.id}`}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === project.id}
              onEdit={openProject}
              onContinueSetup={openProject}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {!isLoading && visibleProjects.length > PROJECTS_PER_PAGE && (
        <Pagination className="mt-5">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} />
            </PaginationItem>
            {getPaginationItems(currentPage, pageCount).map((item, index) =>
              item === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    isActive={item === currentPage}
                    onClick={() => goToPage(item)}
                    aria-label={`Ir a la página ${item}`}
                  >
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <ProjectDrawer
        open={drawerOpen}
        project={editing}
        onOpenChange={setDrawerOpen}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['projects'] })}
      />

      <DeleteConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete project"
        description="This project, its specification, its scans and all of its findings will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete project"
        cancelLabel="Cancel"
        deletingLabel="Deleting…"
        isDeleting={deleteMutation.isPending}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </PageContainer>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof FolderOpen;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border/60 bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-[9px] bg-muted text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}
