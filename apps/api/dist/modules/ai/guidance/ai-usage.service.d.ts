import { PrismaService } from '../../../prisma/prisma.service';
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
    averageCostPerEnrichment: number | null;
    byProvider: AiUsageByProvider[];
    failureBreakdown: {
        errorCode: string;
        count: number;
    }[];
    pricingTableVersion: string;
    costIsEstimated: true;
}
export declare class AiUsageService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getSummary(): Promise<AiUsageSummary>;
}
