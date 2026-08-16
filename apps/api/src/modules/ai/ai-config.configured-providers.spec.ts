import { describe, expect, it } from 'bun:test';
import { AiConfigService } from './ai-config.service';

/**
 * `listConfiguredProviders` answers one question for `GET /ai/status`: does a
 * credential exist anywhere, even though nothing is active?
 *
 * It is what lets the scan UI say "OpenAI is configured but not active" — a
 * one-click fix — instead of "no provider is configured", which sends an
 * operator off to fetch an API key they already have.
 */
function service(rows: Array<{ provider: string; apiKey: string | null }>, env: Record<string, string> = {}) {
  return new AiConfigService(
    { aiProviderConfig: { findMany: async () => rows } } as any,
    { get: (key: string) => env[key] } as any,
    {} as any,
  );
}

describe('AiConfigService.listConfiguredProviders', () => {
  it('reports a provider whose key is stored in the database', async () => {
    const providers = await service([{ provider: 'openai', apiKey: 'encrypted' }]).listConfiguredProviders();
    expect(providers).toEqual(['openai']);
  });

  it('ignores a row created without a key', async () => {
    // Testing a connection upserts a row before any key is saved, so a row on
    // its own is not evidence of a credential.
    const providers = await service([{ provider: 'claude', apiKey: null }]).listConfiguredProviders();
    expect(providers).toEqual([]);
  });

  it('counts Ollama, which authenticates with nothing', async () => {
    const providers = await service([{ provider: 'ollama', apiKey: null }]).listConfiguredProviders();
    expect(providers).toEqual(['ollama']);
  });

  it('counts an instance configured entirely through environment variables', async () => {
    const providers = await service([], { 'ai.gemini.apiKey': 'from-env' }).listConfiguredProviders();
    expect(providers).toEqual(['gemini']);
  });

  it('reports a provider configured in both places exactly once', async () => {
    const providers = await service(
      [{ provider: 'openai', apiKey: 'encrypted' }],
      { 'ai.openai.apiKey': 'from-env' },
    ).listConfiguredProviders();

    expect(providers).toEqual(['openai']);
  });
});
