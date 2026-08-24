'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconAdjustments,
  IconArrowLeft,
  IconBug,
  IconHistory,
  IconInfoCircle,
  IconShieldCheck,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { pluginsApi } from '@/lib/api';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { Plugin, PluginExecution, SecurityIssue } from '@/types';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { SectionTabs } from '@/components/layout/section-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SeverityBadge } from '@/components/security/severity-badge';
import { MethodBadge } from '@/components/security/method-badge';

/**
 * Detail for one security check.
 *
 * Four API methods sat behind this route with no page at all — `plugins.get`,
 * `getExecutions`, `getIssues` and `saveConfig`. `plugins.get` was in fact
 * broken (it answered 500 for any user without a per-check override, which was
 * every user), which is the likely reason a page was never finished.
 *
 * The route directory `plugins/[pluginId]/` already existed and was empty.
 */

type TabId = 'overview' | 'executions' | 'issues' | 'configuration';

const TABS: { id: TabId; label: string; icon: typeof IconInfoCircle }[] = [
  { id: 'overview', label: 'Overview', icon: IconInfoCircle },
  { id: 'executions', label: 'Executions', icon: IconHistory },
  { id: 'issues', label: 'Issues', icon: IconBug },
  { id: 'configuration', label: 'Configuration', icon: IconAdjustments },
];

export default function SecurityCheckDetailPage() {
  const { canWrite } = useCurrentUser();
  const { pluginId } = useParams<{ pluginId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview';

  const { data: plugin, isLoading, isError } = useQuery<Plugin>({
    queryKey: ['plugins', pluginId],
    queryFn: () => pluginsApi.get(pluginId),
    enabled: Boolean(pluginId),
  });

  const toggle = useMutation({
    mutationFn: (isEnabled: boolean) => pluginsApi.toggle(pluginId, isEnabled),
    onSuccess: (_data, isEnabled) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(isEnabled ? 'Check enabled' : 'Check disabled');
    },
    onError: () => toast.error('Could not change this check'),
  });

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-6 h-64 w-full" />
      </PageContainer>
    );
  }

  if (isError || !plugin) {
    return (
      <PageContainer>
        <EmptyState
          icon={IconShieldCheck}
          title="Security check not found"
          description="It may have been removed from the scanner."
          action={
            <Button asChild variant="outline">
              <Link href="/plugins">Back to Security Checks</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/plugins">
          <IconArrowLeft className="h-4 w-4" />
          Back to Security Checks
        </Link>
      </Button>

      <PageHeader
        title={plugin.name}
        description={plugin.description}
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="check-enabled" className="text-xs text-muted-foreground">
              {plugin.isEnabled ? 'Enabled' : 'Disabled'}
            </Label>
            <Switch
              id="check-enabled"
              checked={plugin.isEnabled}
              disabled={toggle.isPending || !canWrite}
              onCheckedChange={(checked) => toggle.mutate(checked)}
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{plugin.category}</Badge>
        {plugin.owaspMappings.map((mapping) => (
          <Badge key={mapping} variant="outline" className="font-mono text-[10px]">
            {mapping}
          </Badge>
        ))}
        <span className="font-mono text-xs text-muted-foreground">v{plugin.version}</span>
        {plugin.isBuiltin && (
          <Badge variant="secondary" className="text-[10px]">
            Built in
          </Badge>
        )}
      </div>

      <SectionTabs
        ariaLabel="Security check sections"
        activeId={activeTab}
        tabs={TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          icon: tab.icon,
          href: `/plugins/${pluginId}?tab=${tab.id}`,
        }))}
      />

      {activeTab === 'overview' && <OverviewTab plugin={plugin} />}
      {activeTab === 'executions' && <ExecutionsTab pluginId={pluginId} />}
      {activeTab === 'issues' && <IssuesTab pluginId={pluginId} />}
      {activeTab === 'configuration' && <ConfigurationTab plugin={plugin} canWrite={canWrite} />}
    </PageContainer>
  );
}

function OverviewTab({ plugin }: { plugin: Plugin }) {
  const findings = plugin.stats?.findingsBySeverity ?? {};
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">What this check does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>{plugin.longDescription || plugin.description}</p>
          {plugin.documentationUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={plugin.documentationUrl} target="_blank" rel="noopener noreferrer">
                Reference documentation
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current issues</CardTitle>
            <CardDescription>
              Open issues attributed to this check — not one row per detection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {severities.every((s) => !findings[s]) ? (
              <p className="text-sm text-muted-foreground">No issues attributed to this check.</p>
            ) : (
              severities
                .filter((s) => findings[s])
                .map((s) => (
                  <div key={s} className="flex items-center justify-between">
                    <SeverityBadge severity={s} size="sm" />
                    <span className="text-sm font-medium tabular-nums">{findings[s]}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent execution</CardTitle>
            <CardDescription>Across the last 20 runs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Runs recorded" value={String(plugin.stats?.totalExecutions ?? 0)} />
            <Row label="Success rate" value={`${plugin.stats?.successRate ?? 0}%`} />
            <Row
              label="Average duration"
              value={
                plugin.stats?.avgDurationMs
                  ? formatDuration(plugin.stats.avgDurationMs)
                  : '—'
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExecutionsTab({ pluginId }: { pluginId: string }) {
  const { data: executions = [], isLoading } = useQuery<PluginExecution[]>({
    queryKey: ['plugins', pluginId, 'executions'],
    queryFn: () => pluginsApi.getExecutions(pluginId),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Execution history</CardTitle>
        <CardDescription>
          Every recorded run of this check, newest first. A failed or timed-out run means its
          findings could not be proven absent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <EmptyState icon={IconHistory} title="This check has not run yet" compact />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {executions.map((execution) => (
              <li key={execution.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ExecutionStatusBadge status={execution.status} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(execution.startedAt)}
                    </span>
                  </div>
                  {execution.errorMessage && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {execution.errorMessage}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {execution.findingsCount} {execution.findingsCount === 1 ? 'finding' : 'findings'}
                  </span>
                  <span className="tabular-nums">
                    {execution.durationMs ? formatDuration(execution.durationMs) : '—'}
                  </span>
                  {execution.assessmentId && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/assessments/${execution.assessmentId}`}>Scan</Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'SUCCESS'
      ? 'border-success/30 text-success'
      : status === 'FAILED'
        ? 'border-destructive/30 text-destructive'
        : status === 'TIMEOUT'
          ? 'border-severity-high/30 text-severity-high'
          : 'border-border text-muted-foreground';

  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-medium', tone)}>
      {status}
    </Badge>
  );
}

function IssuesTab({ pluginId }: { pluginId: string }) {
  const { data: issues = [], isLoading } = useQuery<SecurityIssue[]>({
    queryKey: ['plugins', pluginId, 'issues'],
    queryFn: () => pluginsApi.getIssues(pluginId),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issues found by this check</CardTitle>
        <CardDescription>Persistent vulnerabilities, deduplicated across scans.</CardDescription>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <EmptyState
            icon={IconBug}
            title="No issues from this check"
            description="Either it has not run, or it ran and found nothing."
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {issues.map((issue) => (
              <li key={issue.id}>
                <Link
                  href={`/issues/${issue.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{issue.title}</p>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                      <MethodBadge method={issue.method} />
                      {issue.normalizedRoute}
                    </span>
                  </div>
                  <SeverityBadge severity={issue.severity} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigurationTab({ plugin, canWrite }: { plugin: Plugin; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const fields = plugin.configSchema?.fields ?? [];

  const initial = useMemo(
    () => ({ ...(plugin.defaultConfig ?? {}), ...(plugin.userConfig ?? {}) }),
    [plugin.defaultConfig, plugin.userConfig],
  );
  const [values, setValues] = useState<Record<string, any>>(initial);

  const save = useMutation({
    mutationFn: (config: Record<string, any>) => pluginsApi.saveConfig(plugin.id, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins', plugin.id] });
      toast.success('Configuration saved');
    },
    onError: () => toast.error('Could not save the configuration'),
  });

  if (fields.length === 0) {
    return (
      <Card>
        <CardContent className="py-10">
          <EmptyState
            icon={IconAdjustments}
            title="This check has no configurable options"
            description="It runs with fixed behaviour. Nothing here is adjustable."
            compact
          />
        </CardContent>
      </Card>
    );
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuration</CardTitle>
        <CardDescription>
          Saved for your account only. Other users keep their own settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={`cfg-${field.key}`} className="mb-1.5 block text-xs font-medium">
              {field.label}
            </Label>

            {field.type === 'boolean' ? (
              <Switch
                id={`cfg-${field.key}`}
                checked={Boolean(values[field.key])}
                disabled={!canWrite}
                onCheckedChange={(checked) =>
                  setValues((prev) => ({ ...prev, [field.key]: checked }))
                }
              />
            ) : (
              <Input
                id={`cfg-${field.key}`}
                type={field.type === 'number' ? 'number' : 'text'}
                value={values[field.key] ?? ''}
                min={field.min}
                max={field.max}
                disabled={!canWrite}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]:
                      field.type === 'number'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value,
                  }))
                }
              />
            )}

            {field.description && (
              <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2">
          <Button disabled={!dirty || save.isPending || !canWrite} onClick={() => save.mutate(values)}>
            {save.isPending ? 'Saving…' : 'Save configuration'}
          </Button>
          {dirty && canWrite && (
            <Button variant="ghost" size="sm" onClick={() => setValues(initial)}>
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
