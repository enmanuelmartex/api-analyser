'use client';

import { useQuery } from '@tanstack/react-query';
import { IconCoin, IconInfoCircle } from '@tabler/icons-react';
import { aiApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import type { AiUsageSummary } from '@/types';

/**
 * What AI enrichment has actually consumed.
 *
 * This replaces the removed `financeApi`, which called `/finance/summary` and
 * `/finance/usage` against a module directory with no files in it — every call
 * 404'd, and the Finance screen was a top-level navigation entry that could
 * never load. Nothing here is invented: every figure is aggregated from stored
 * `IssueGuidance` rows.
 *
 * Cost is an ESTIMATE and is labelled as one everywhere it appears.
 */
export function AiUsageTab() {
  const { data, isLoading, isError } = useQuery<AiUsageSummary>({
    queryKey: ['ai', 'usage'],
    queryFn: aiApi.usage,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8">
          <EmptyState
            icon={IconCoin}
            title="Usage could not be loaded"
            description="AI usage is reported from stored enrichments; it is not shown rather than estimated."
            compact
          />
        </CardContent>
      </Card>
    );
  }

  if (data.totalEnrichments === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <EmptyState
            icon={IconCoin}
            title="No AI enrichment recorded yet"
            description="Run a scan with AI analysis enabled and a provider configured. Usage and estimated cost will appear here."
            compact
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
        <Tile label="Enrichments" value={String(data.totalEnrichments)} />
        <Tile label="Succeeded" value={String(data.succeeded)} tone="text-success" />
        <Tile
          label="Failed"
          value={String(data.failed)}
          tone={data.failed > 0 ? 'text-severity-high' : undefined}
        />
        <Tile label="Estimated cost" value={formatUsd(data.estimatedCostUsd)} />
      </div>

      <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <IconInfoCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>
          Costs are <span className="font-medium text-foreground">estimated</span> from list prices
          ({data.pricingTableVersion}), not from provider invoices. Discounts, cached-token rates
          and free tiers are not reflected.
        </span>
      </p>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">By provider and model</h3>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Provider</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Runs</th>
                <th className="px-3 py-2 text-right font-medium">Tokens in</th>
                <th className="px-3 py-2 text-right font-medium">Tokens out</th>
                <th className="px-3 py-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.byProvider.map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td className="px-3 py-2">{row.provider}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {row.tokensInput.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {row.tokensOutput.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatUsd(row.estimatedCostUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.averageCostPerEnrichment != null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Average {formatUsd(data.averageCostPerEnrichment)} per successful enrichment.
          </p>
        )}
      </section>

      {data.failureBreakdown.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Failures</h3>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {data.failureBreakdown.map((row) => (
              <li key={row.errorCode} className="flex items-center justify-between px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">{row.errorCode}</span>
                <span className="text-sm tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A failed enrichment never affects a scan result — scanner evidence is recorded
            regardless.
          </p>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone ?? 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}

/** Sub-cent amounts are common; showing "$0.00" would read as free. */
function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
