import type { AiProviderStatus } from '@/types';

export type AiAvailability =
  /** The status request has not answered yet. */
  | 'loading'
  /** A provider is configured with a usable credential. */
  | 'ready'
  /** Someone explicitly turned AI off for the instance. */
  | 'disabled'
  /** A provider is selected but has no API key — the case that used to fail mid-scan. */
  | 'unconfigured'
  /** The status endpoint itself failed. Never used to block: we do not know. */
  | 'unknown';

/**
 * Turns `GET /ai/status` into the four states the UI actually behaves
 * differently for.
 *
 * The distinction that matters is `unconfigured` versus `unknown`. The first is
 * a fact the server told us — a provider with no key, which will skip every
 * enrichment — and it is the state that justifies disabling the toggle. The
 * second is our own ignorance, because the status call failed, and disabling a
 * feature on the strength of a failed health check would silently drop
 * enrichment from scans on an instance where it works perfectly.
 */
export function deriveAiAvailability(
  status: AiProviderStatus | undefined,
  isLoading: boolean,
): AiAvailability {
  if (isLoading) return 'loading';
  if (!status) return 'unknown';
  if (status.available) return 'ready';
  return status.provider === 'none' ? 'disabled' : 'unconfigured';
}

/** True only for the states in which enrichment demonstrably cannot run. */
export function blocksAiEnrichment(availability: AiAvailability): boolean {
  return availability === 'disabled' || availability === 'unconfigured';
}
