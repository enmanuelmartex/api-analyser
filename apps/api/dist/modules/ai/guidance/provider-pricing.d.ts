export declare const PRICING_TABLE_VERSION = "pricing-2026.08";
export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
}
export declare function estimateCostUsd(provider: string, model: string, tokensInput: number, tokensOutput: number): number;
export declare function findPricing(provider: string, model: string): ModelPricing | null;
export declare function splitTokens(total: number, reported?: {
    input?: number;
    output?: number;
}): {
    tokensInput: number;
    tokensOutput: number;
};
