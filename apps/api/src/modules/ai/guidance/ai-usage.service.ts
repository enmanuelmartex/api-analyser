import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PRICING_TABLE_VERSION } from './provider-pricing';

/**
 * AI spend and volume, from real stored enrichments.
 *
 * There was a `financeApi` and a `Finance*` type family in the frontend that
 * called `/finance/summary` and `/finance/usage` against a module directory
 * containing no files — every call 404'd. Rather than resurrect a fabricated
 * finance section, this reports exactly what the guidance pipeline recorded:
 * how many enrichments ran, how many tokens they consumed, and what that is
 * estimated to have cost.
 *
 * COST IS ESTIMATED. It is computed from a versioned list-price table, not from
 * a provider invoice, and ignores discounts, cached-token rates and free tiers.
 * `pricingTableVersion` travels with the response so the UI can say so.
 */

export interface AiUsageByProvider {
  provider: string;
  model: string;
  count: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
}

export interface AiUsageSummary {
  totalEnrichments: number;
  succeeded: number;
  failed: number;
  skipped: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
  /** Mean cost of a successful enrichment; null when there are none. */
  averageCostPerEnrichment: number | null;
  byProvider: AiUsageByProvider[];
  /** Failure codes and how often each occurred. */
  failureBreakdown: { errorCode: string; count: number }[];
  pricingTableVersion: string;
  costIsEstimated: true;
}

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<AiUsageSummary> {
    const guidance = this.prisma as any;

    const [rows, byStatus, byProviderModel, failures] = await Promise.all([
      guidance.issueGuidance.aggregate({
        _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
        _count: { _all: true },
      }),
      guidance.issueGuidance.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      guidance.issueGuidance.groupBy({
        by: ['provider', 'model'],
        _count: { _all: true },
        _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
      }),
      guidance.issueGuidance.groupBy({
        by: ['errorCode'],
        where: { status: 'FAILED' },
        _count: { _all: true },
      }),
    ]);

    const statusCount = (status: string) =>
      byStatus.find((row: any) => row.status === status)?._count?._all ?? 0;

    const succeeded = statusCount('READY');
    const totalCost = Number((rows._sum.costUsd ?? 0).toFixed(6));

    return {
      totalEnrichments: rows._count._all ?? 0,
      succeeded,
      failed: statusCount('FAILED'),
      skipped: statusCount('SKIPPED'),
      tokensInput: rows._sum.tokensInput ?? 0,
      tokensOutput: rows._sum.tokensOutput ?? 0,
      estimatedCostUsd: totalCost,
      // Averaged over successes only: dividing by failures too would understate
      // what a working enrichment actually costs.
      averageCostPerEnrichment: succeeded > 0 ? Number((totalCost / succeeded).toFixed(6)) : null,
      byProvider: byProviderModel
        .map((row: any) => ({
          provider: row.provider,
          model: row.model,
          count: row._count._all,
          tokensInput: row._sum.tokensInput ?? 0,
          tokensOutput: row._sum.tokensOutput ?? 0,
          estimatedCostUsd: Number((row._sum.costUsd ?? 0).toFixed(6)),
        }))
        .sort((a: AiUsageByProvider, b: AiUsageByProvider) => b.estimatedCostUsd - a.estimatedCostUsd),
      failureBreakdown: failures
        .map((row: any) => ({ errorCode: row.errorCode ?? 'UNKNOWN', count: row._count._all }))
        .sort((a: any, b: any) => b.count - a.count),
      pricingTableVersion: PRICING_TABLE_VERSION,
      costIsEstimated: true,
    };
  }
}
