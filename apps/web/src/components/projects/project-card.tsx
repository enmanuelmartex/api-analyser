'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, Check, ChevronRight, Clock, Copy, Pencil, Radar, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ENVIRONMENT_LABELS,
  formatRelativeEs,
  getScanCount,
  type ProjectEnvironment,
  type ProjectListItem,
} from '@/lib/project-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Tinted, never solid — same hue for background and text. */
const ENVIRONMENT_TINT: Record<ProjectEnvironment, string> = {
  DEVELOPMENT: 'bg-success/10 text-success',
  STAGING: 'bg-severity-medium/10 text-severity-medium',
  PRODUCTION: 'bg-destructive/10 text-destructive',
};

const FOOTER_LINK_CLASS =
  'flex items-center gap-0.5 rounded-md text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export type ProjectCardProps = {
  project: ProjectListItem;
  /** Destination for the "Ver" link. */
  href: string;
  isDeleting?: boolean;
  onEdit: (_project: ProjectListItem) => void;
  onDelete: (_project: ProjectListItem) => void;
  onContinueSetup: (_project: ProjectListItem) => void;
  /** VIEWER is read-only: no edit, delete or draft setup. */
  canWrite?: boolean;
  className?: string;
};

export function ProjectCard({
  project,
  href,
  isDeleting = false,
  onEdit,
  onDelete,
  onContinueSetup,
  canWrite = true,
  className,
}: ProjectCardProps) {
  const isDraft = project.status === 'DRAFT';
  const scanCount = getScanCount(project);
  const name = project.name || 'Proyecto sin nombre';

  return (
    <TooltipProvider delayDuration={300}>
      <Card
        className={cn(
          'flex h-full flex-col rounded-xl border-border/60 shadow-none transition-colors hover:border-border',
          isDeleting && 'pointer-events-none opacity-60',
          className,
        )}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary"
              >
                <Radar className="size-[17px]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 pt-px">
                <h3 className="truncate text-[15px] font-medium leading-5 text-foreground">{name}</h3>
                <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">
                  {project.description || 'Sin descripción'}
                </p>
              </div>
            </div>

            {canWrite && (
              <div className="flex shrink-0 items-center self-start overflow-hidden rounded-lg border border-border/70">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(project)}
                      aria-label={`Editar ${name}`}
                      className="size-8 rounded-none text-muted-foreground [&_svg]:size-[15px] hover:text-foreground"
                    >
                      <Pencil />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Editar</TooltipContent>
                </Tooltip>

                <span aria-hidden="true" className="h-5 w-[0.5px] shrink-0 bg-border" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(project)}
                      aria-label={`Eliminar ${name}`}
                      className="size-8 rounded-none text-muted-foreground [&_svg]:size-[15px] hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Eliminar</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          <BaseUrlRow url={project.baseUrl} />
        </div>

        <div className="mt-auto">
          <Separator />
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex items-center gap-1.5">
                <Activity className="size-3.5 shrink-0" />
                {scanCount} {scanCount === 1 ? 'escaneo' : 'escaneos'}
              </span>
              <span className="flex items-center gap-1.5 truncate">
                <Clock className="size-3.5 shrink-0" />
                {formatRelativeEs(project.updatedAt)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isDraft ? (
                <>
                  <Badge className="h-5 border-transparent bg-severity-medium/10 px-2 text-[11px] font-medium text-severity-medium">
                    Paso {project.setupStep || 1} de 3
                  </Badge>
                  {canWrite && (
                    <button type="button" onClick={() => onContinueSetup(project)} className={FOOTER_LINK_CLASS}>
                      Continuar configuración
                      <ChevronRight className="size-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <Badge
                    className={cn(
                      'h-5 border-transparent px-2 text-[11px] font-medium',
                      ENVIRONMENT_TINT[project.environment],
                    )}
                  >
                    {ENVIRONMENT_LABELS[project.environment]}
                  </Badge>
                  <Link href={href} className={FOOTER_LINK_CLASS}>
                    Ver
                    <ChevronRight className="size-3.5" />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </TooltipProvider>
  );
}

function BaseUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  const timeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked by permissions; the URL stays selectable either way.
    }
  }

  return (
    <div className="group/url flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={url || undefined}>
        {url || 'Sin URL base'}
      </span>
      {url && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'URL copiada' : 'Copiar URL'}
          className="shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/url:opacity-100"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

/** Mirrors the card structure so the grid does not shift when data arrives. */
export function ProjectCardSkeleton() {
  return (
    <Card className="flex h-full flex-col rounded-xl border-border/60 shadow-none">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <Skeleton className="size-[34px] shrink-0 rounded-[9px]" />
            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full max-w-[11rem]" />
            </div>
          </div>
          <Skeleton className="h-8 w-[65px] rounded-lg" />
        </div>
        <Skeleton className="h-[34px] w-full rounded-lg" />
      </div>
      <div className="mt-auto">
        <Separator />
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
    </Card>
  );
}
