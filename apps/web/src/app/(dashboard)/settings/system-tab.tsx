'use client';

import { useQuery } from '@tanstack/react-query';
import { IconAlertTriangle } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { systemApi } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OwaspCoverageMatrix,
  OwaspCoverageSummaryLine,
} from '@/components/security/owasp-coverage-matrix';
import {
  SettingsPanel,
  SettingsRows,
  SettingsSection,
  StatRow,
} from './_components/settings-primitives';

/**
 * Settings → System.
 *
 * Every value is read from `GET /system/info`. This tab used to be a hardcoded
 * list: it claimed "11 OWASP Plugins Active" against ten checks, showed SSRF as
 * disabled while it was enabled in the database, and listed seven OWASP
 * categories with no indication that three others exist and are untested.
 */
export function SystemTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system', 'info'],
    queryFn: systemApi.info,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <SettingsPanel>
        <SettingsSection title="Runtime" description="Infrastructure this instance is running on.">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  if (isError || !data) {
    return (
      <SettingsPanel>
        <SettingsSection title="Runtime" description="Infrastructure this instance is running on.">
          <Alert variant="destructive">
            <IconAlertTriangle />
            <div className="flex-1">
              <AlertDescription>
                {(error as any)?.response?.data?.message ??
                  'The API did not respond. System details are unavailable rather than estimated.'}
              </AlertDescription>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  const { product, runtime, securityChecks, owasp } = data;

  return (
    <SettingsPanel>
      <SettingsSection title="Runtime" description="Infrastructure this instance is running on.">
        <SettingsRows>
          <StatRow label="Platform" value={`${product.name} API v1`} />
          <StatRow label="Version" value={product.version} />
          <StatRow label="Environment" value={runtime.environment} />
          <StatRow
            label="Runtime"
            value={
              runtime.bunVersion
                ? `Bun ${runtime.bunVersion} + ${runtime.apiFramework}`
                : `Node ${runtime.nodeVersion} + ${runtime.apiFramework}`
            }
          />
          <StatRow label="API uptime" value={formatUptime(runtime.uptimeSeconds)} />
          <StatRow
            label="Security checks"
            value={`${securityChecks.enabled} of ${securityChecks.total} enabled · ${securityChecks.totalRules} rules`}
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        title="OWASP API Security Top 10"
        description="Which categories the installed checks actually test."
      >
        <OwaspCoverageSummaryLine coverage={owasp} className="mb-4" />
        <OwaspCoverageMatrix coverage={owasp} />
      </SettingsSection>

      <SettingsSection
        title="Installed security checks"
        description="Enablement is read from the database, not assumed."
      >
        <div className="-my-1 divide-y divide-border">
          {securityChecks.checks.map((check) => (
            <div key={check.id} className="flex items-center gap-3 py-2">
              <div
                className={cn(
                  'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                  check.isEnabled ? 'bg-success' : 'bg-muted-foreground/40',
                )}
                aria-hidden="true"
              />
              <span className="w-24 flex-shrink-0 font-mono text-[10px] text-muted-foreground">
                {check.owaspMappings.map((mapping) => mapping.split(':')[0]).join(', ') || '—'}
              </span>
              <span className="flex-1 truncate text-sm text-foreground">{check.name}</span>
              <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                {check.ruleCount} {check.ruleCount === 1 ? 'rule' : 'rules'}
              </span>
              <span
                className={cn(
                  'w-16 flex-shrink-0 text-right text-[10px] font-semibold uppercase',
                  check.isEnabled ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {check.isEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}

/** Renders seconds as a short human duration, e.g. "3d 4h" or "12m". */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
