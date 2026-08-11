"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICING_TABLE_VERSION = void 0;
exports.estimateCostUsd = estimateCostUsd;
exports.findPricing = findPricing;
exports.splitTokens = splitTokens;
exports.PRICING_TABLE_VERSION = 'pricing-2026.08';
const PRICING = {
    claude: {
        'claude-opus': { inputPerMillion: 15, outputPerMillion: 75 },
        'claude-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
        'claude-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
    },
    openai: {
        'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
        'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
        'gpt-4': { inputPerMillion: 30, outputPerMillion: 60 },
    },
    gemini: {
        'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
        'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
        gemini: { inputPerMillion: 1.25, outputPerMillion: 5 },
    },
    grok: {
        grok: { inputPerMillion: 2, outputPerMillion: 10 },
    },
    ollama: {
        '': { inputPerMillion: 0, outputPerMillion: 0 },
    },
    noop: {
        '': { inputPerMillion: 0, outputPerMillion: 0 },
    },
};
function estimateCostUsd(provider, model, tokensInput, tokensOutput) {
    const pricing = findPricing(provider, model);
    if (!pricing)
        return 0;
    const cost = (tokensInput / 1_000_000) * pricing.inputPerMillion +
        (tokensOutput / 1_000_000) * pricing.outputPerMillion;
    return Number(cost.toFixed(6));
}
function findPricing(provider, model) {
    const table = PRICING[provider?.toLowerCase()];
    if (!table)
        return null;
    const normalisedModel = (model ?? '').toLowerCase();
    let best = null;
    for (const [prefix, pricing] of Object.entries(table)) {
        if (normalisedModel.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
            best = { prefix, pricing };
        }
    }
    return best?.pricing ?? null;
}
function splitTokens(total, reported) {
    if (reported?.input != null || reported?.output != null) {
        return { tokensInput: reported.input ?? 0, tokensOutput: reported.output ?? 0 };
    }
    return { tokensInput: 0, tokensOutput: Math.max(0, total) };
}
//# sourceMappingURL=provider-pricing.js.map