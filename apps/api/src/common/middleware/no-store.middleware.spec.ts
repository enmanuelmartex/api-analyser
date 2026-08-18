import { describe, expect, it, mock } from 'bun:test';
import { noStoreForApi } from './no-store.middleware';

function run(originalUrl: string) {
  const headers: Record<string, string> = {};
  const req = { originalUrl } as any;
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) } as any;
  const next = mock(() => {});

  noStoreForApi()(req, res, next);

  return { headers, next };
}

describe('noStoreForApi', () => {
  it('sets Cache-Control: no-store on /api/v1 requests', () => {
    const { headers, next } = run('/api/v1/ai/config');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });

  it('applies regardless of query string or nested path', () => {
    expect(run('/api/v1/projects/abc123?include=stats').headers['Cache-Control']).toBe('no-store');
  });

  it('does not touch /api/auth (Better Auth), which this middleware is never mounted in front of anyway', () => {
    expect(run('/api/auth/sign-in/email').headers['Cache-Control']).toBeUndefined();
  });

  it('does not touch Swagger UI, which legitimately benefits from caching', () => {
    expect(run('/api/docs').headers['Cache-Control']).toBeUndefined();
  });

  it('always calls next(), whether or not it set the header', () => {
    expect(run('/health').next).toHaveBeenCalled();
  });
});
