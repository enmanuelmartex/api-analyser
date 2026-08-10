'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  IconPuzzle,
  IconShieldLock,
  IconSearch,
  IconToggleLeft,
  IconToggleRight,
  IconChevronRight,
  IconClock,
  IconAlertTriangle,
  IconCircleCheck,
  IconBolt,
  IconLock,
  IconStack,
  IconActivity,
  IconCloudCog,
  IconAdjustments,
} from '@tabler/icons-react';
import { pluginsApi } from '@/lib/api';
import type { Plugin } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { SecurityChecksTabs } from '@/components/navigation/security-checks-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

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

  const categories = ['all', ...Array.from(new Set(plugins.map((p) => p.category))).sort()];

  const filtered = plugins.filter((p) => {
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.includes(search.toLowerCase()));
    const matchCategory = selectedCategory === 'all' || p.category === selectedCategory;
    return matchSearch && matchCategory;
  });

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

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            { label: 'Installed', value: plugins.length, color: 'text-foreground' },
            { label: 'Enabled', value: enabledCount, color: 'text-success' },
            { label: 'Disabled', value: plugins.length - enabledCount, color: 'text-muted-foreground' },
            { label: 'Categories', value: new Set(plugins.map((p) => p.category)).size, color: 'text-primary' },
          ] as const
        ).map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="mb-1 text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + category filter */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plugins…" className="pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                selectedCategory === cat
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={IconPuzzle} title="No plugins match your search" />
          </CardContent>
        </Card>
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
