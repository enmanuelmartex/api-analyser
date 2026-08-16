import { describe, expect, it } from 'bun:test';
import { blocksAiEnrichment, deriveAiAvailability } from './ai-availability';

/**
 * These four states drive whether the "AI security enrichment" toggle can be
 * turned on at all. The regression they guard against is the one this logic was
 * written for: a scan accepted with enrichment requested on an instance that had
 * no API key, which ran for minutes and then reported the configuration problem
 * in its summary.
 */
describe('deriveAiAvailability', () => {
  const status = (over: Partial<Parameters<typeof deriveAiAvailability>[0]> = {}) => ({
    provider: 'openai',
    model: 'gpt-4o-mini',
    available: false,
    ...over,
  });

  it('is loading until the status request answers', () => {
    expect(deriveAiAvailability(undefined, true)).toBe('loading');
    // Data already cached from a previous mount still counts as loading only
    // while the request is in flight for the first time.
    expect(deriveAiAvailability(status({ available: true }), false)).toBe('ready');
  });

  it('reads a provider with no credential as unconfigured', () => {
    expect(deriveAiAvailability(status({ reason: 'No API key configured for openai' }), false))
      .toBe('unconfigured');
  });

  it('distinguishes AI switched off from AI never set up', () => {
    expect(deriveAiAvailability(status({ provider: 'none', model: 'none' }), false)).toBe('disabled');
  });

  it('reports unknown when the status call itself produced nothing', () => {
    expect(deriveAiAvailability(undefined, false)).toBe('unknown');
  });
});

describe('blocksAiEnrichment', () => {
  it('blocks the two states the server has confirmed cannot run', () => {
    expect(blocksAiEnrichment('unconfigured')).toBe(true);
    expect(blocksAiEnrichment('disabled')).toBe(true);
  });

  it('never blocks on our own ignorance', () => {
    // A failed /ai/status must not strip enrichment from a scan on an instance
    // where the provider is fine — the scan degrades gracefully either way.
    expect(blocksAiEnrichment('unknown')).toBe(false);
    expect(blocksAiEnrichment('loading')).toBe(false);
    expect(blocksAiEnrichment('ready')).toBe(false);
  });
});
