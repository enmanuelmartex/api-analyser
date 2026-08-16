'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  IconPuzzle,
  IconShieldLock,
  IconToggleLeft,
  IconToggleRight,
  IconChevronRight,
  IconCircleOff,
  IconClock,
  IconAlertTriangle,
  IconCircleCheck,
  IconBolt,
  IconLayersIntersect,
  IconLock,
  IconPackages,
  IconStack,
  IconActivity,
  IconCloudCog,
  IconAdjustments,
} from '@tabler/icons-react';
import { pluginsApi } from '@/lib/api';
import type { Plugin } from '@/types';
import { cn } from '@/lib/utils';
import {
  EMPTY_PLUGIN_FILTERS,
  filterPlugins,
  getPluginCategories,
  hasActivePluginFilters,
  parsePluginFilters,
  pluginsHref,
  serializePluginFilters,
  type PluginFilterState,
} from '@/lib/plugin-list';
import { toast } from 'sonner';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { SecurityChecksTabs } from '@/components/navigation/security-checks-tabs';
import { PluginFilters } from '@/components/plugins/plugin-filters';
import { MetricCard, MetricCardSkeleton } from '@/components/shared/metric-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const CATEGORY_ICONS: Record<string, typeof IconPuzzle> = {
  Authentication: IconLock,
  Authorization: IconShieldLock,
  Headers: IconStack,
  Injection: IconAlertTriangle,
  'API Design': IconAdjustments,
  Performance: IconBolt,
  Infrastructure: IconCloudCog,
  Compliance: IconCircleCheck,
  AI: IconActivity,
};

const CATEGORY_COLORS: Record<string, string> = {
  Authentication: 'text-primary bg-primary/10 border-primary/20',
  Authorization: 'text-chart-2 bg-chart-2/10 border-chart-2/20',
  Headers: 'text-cyan bg-cyan/10 border-cyan/20',
  Injection: 'text-destructive bg-destructive/10 border-destructive/20',
  'API Design': 'text-muted-foreground bg-muted border-border',
  Performance: 'text-severity-medium bg-severity-medium/10 border-severity-medium/20',
  Infrastructure: 'text-severity-high bg-severity-high/10 border-severity-high/20',
  Compliance: 'text-success bg-success/10 border-success/20',
  AI: 'text-chart-3 bg-chart-3/10 border-chart-3/20',
};

export default function PluginsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: plugins = [], isLoading } = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: pluginsApi.list,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => pluginsApi.toggle(id, isEnabled),
    onSuccess: (_, { isEnabled }) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(isEnabled ? 'Plugin enabled' : 'Plugin disabled');
    },
    onError: () => toast.error('Failed to update plugin'),
  });

  // Filters live in the URL so the summary cards can link to a filtered list,
  // and so the controls below always show the filter that is actually applied.
  const filters = useMemo(
    () => parsePluginFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const applyFilters = useCallback(
    (next: PluginFilterState) => {
      const query = serializePluginFilters(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const categories = useMemo(() => getPluginCategories(plugins), [plugins]);
  const filtered = useMemo(() => filterPlugins(plugins, filters), [plugins, filters]);
  const filtersActive = hasActivePluginFilters(filters);

  const enabledCount = plugins.filter((p) => p.isEnabled).length;

  return (
    <PageContainer>
      {/*
        "Security Checks", not "Plugins": these checks are compiled into the
        scanner. The old name implied a package registry and third-party
        installation, neither of which exists.
      */}
      <PageHeader
        title="Security Checks"
        description={`${enabledCount} of ${plugins.length} enabled`}
      />

      <SecurityChecksTabs active="checks" />

      {/*
        Clicking a card filters the list below to what it counts. "Categories"
        is not a link: it counts every category at once, so there is no single
        one it could narrow to — the Category select below is where that choice
        is made. It stays informational rather than leading nowhere.
      */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              title="Installed"
              value={plugins.length}
              icon={<IconPackages />}
              description="Available security checks"
              href={pluginsHref()}
            />
            <MetricCard
              title="Enabled"
              value={enabledCount}
              icon={<IconCircleCheck />}
              accent="success"
              description={enabledCount ? 'Run on every scan' : 'No check will run on a scan'}
              href={pluginsHref({ state: 'enabled' })}
            />
            <MetricCard
              title="Disabled"
              value={plugins.length - enabledCount}
              icon={<IconCircleOff />}
              description="Inactive security checks"
              href={pluginsHref({ state: 'disabled' })}
            />
            <MetricCard
              title="Categories"
              value={categories.length}
              icon={<IconLayersIntersect />}
              accent="primary"
              description="Security check categories"
            />
          </>
        )}
      </div>

      {/* The state a card links to has to be readable here, or the list would
          silently show a subset with nothing on screen explaining why. */}
      <PluginFilters
        value={filters}
        onChange={applyFilters}
        categories={categories}
        className="mb-4"
      />

      {/* Plugin grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={IconPuzzle}
          title={filtersActive ? 'No checks match these filters' : 'No checks installed'}
          description={
            filtersActive
              ? 'Clear the filters to see every installed check.'
              : 'The scanner reported no security checks.'
          }
          action={
            filtersActive ? (
              <Button variant="outline" size="sm" onClick={() => applyFilters(EMPTY_PLUGIN_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onToggle={(isEnabled) => toggleMutation.mutate({ id: plugin.id, isEnabled })} isToggling={toggleMutation.isPending} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function PluginCard({ plugin, onToggle, isToggling }: { plugin: Plugin; onToggle: (_v: boolean) => void; isToggling: boolean }) {
  const Icon = CATEGORY_ICONS[plugin.category] ?? IconPuzzle;
  const colorClass = CATEGORY_COLORS[plugin.category] ?? 'text-muted-foreground bg-muted border-border';

  return (
    <Card className={cn('flex flex-col gap-4 p-5 transition-all', plugin.isEnabled ? 'hover:border-foreground/20' : 'opacity-60 hover:opacity-80')}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border', colorClass)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{plugin.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">v{plugin.version}</p>
          </div>
        </div>
        <button
          onClick={() => onToggle(!plugin.isEnabled)}
          disabled={isToggling}
          className="flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          title={plugin.isEnabled ? 'Disable plugin' : 'Enable plugin'}
        >
          {plugin.isEnabled ? <IconToggleRight className="h-6 w-6 text-primary" /> : <IconToggleLeft className="h-6 w-6" />}
        </button>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>

      {/* OWASP tags */}
      <div className="flex flex-wrap gap-1">
        {plugin.owaspMappings.map((owasp) => (
          <span key={owasp} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {owasp}
          </span>
        ))}
        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', colorClass)}>{plugin.category}</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-1">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {plugin.stats && (
            <>
              <span className="flex items-center gap-1">
                <IconActivity className="h-3 w-3" />
                {plugin.stats.totalExecutions} runs
              </span>
              {plugin.stats.avgDurationMs > 0 && (
                <span className="flex items-center gap-1">
                  <IconClock className="h-3 w-3" />
                  {plugin.stats.avgDurationMs}ms avg
                </span>
              )}
            </>
          )}
        </div>
        <Link href={`/plugins/${plugin.id}`} className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary">
          Details
          <IconChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}
