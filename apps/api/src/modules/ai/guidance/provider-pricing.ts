/**
 * Token pricing used to estimate what enrichment costs.
 *
 * ESTIMATED, NEVER BILLED. These are list prices per million tokens, they go
 * stale, and providers apply discounts, cached-token rates and free tiers this
 * table knows nothing about. Every figure derived from it must be labelled as
 * an estimate wherever it is shown.
 *
 * Versioned and kept in one place rather than scattered as constants through
 * the UI, so a price change is a single edit with a visible date.
 */

export const PRICING_TABLE_VERSION = 'pricing-2026.08';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

/**
 * Keyed by provider, then by a model-name prefix. The longest matching prefix
 * wins, so `claude-opus-5` matches an `claude-opus` entry without needing a row
 * for every point release.
 */
const PRICING: Record<string, Record<string, ModelPricing>> = {
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
  // Runs on the user's own hardware: no per-token charge to estimate.
  ollama: {
    '': { inputPerMillion: 0, outputPerMillion: 0 },
  },
  noop: {
    '': { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

/**
 * Estimates cost in USD. Returns 0 for an unknown provider or model rather
 * than guessing — an invented number is worse than a visible zero, and the UI
 * shows how many events had no price attached.
 */
export function estimateCostUsd(
  provider: string,
  model: string,
  tokensInput: number,
  tokensOutput: number,
): number {
  const pricing = findPricing(provider, model);
  if (!pricing) return 0;

  const cost =
    (tokensInput / 1_000_000) * pricing.inputPerMillion +
    (tokensOutput / 1_000_000) * pricing.outputPerMillion;

  // Six decimals: a single enrichment on a cheap model costs well under a cent.
  return Number(cost.toFixed(6));
}

export function findPricing(provider: string, model: string): ModelPricing | null {
  const table = PRICING[provider?.toLowerCase()];
  if (!table) return null;

  const normalisedModel = (model ?? '').toLowerCase();

  let best: { prefix: string; pricing: ModelPricing } | null = null;
  for (const [prefix, pricing] of Object.entries(table)) {
    if (normalisedModel.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, pricing };
    }
  }
  return best?.pricing ?? null;
}

/**
 * Splits a provider's single `tokensUsed` figure into input and output.
 *
 * Several providers in this codebase report only a total. Guessing a split
 * would be fabrication, so the total is attributed entirely to output — the
 * more expensive side — which keeps the estimate conservative rather than
 * flattering. Providers that report both are passed through untouched.
 */
export function splitTokens(
  total: number,
  reported?: { input?: number; output?: number },
): { tokensInput: number; tokensOutput: number } {
  if (reported?.input != null || reported?.output != null) {
    return { tokensInput: reported.input ?? 0, tokensOutput: reported.output ?? 0 };
  }
  return { tokensInput: 0, tokensOutput: Math.max(0, total) };
}
