import { describe, expect, test } from 'bun:test';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  test('reports the service as ok', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'api-analyzer-mail-relay',
    });
  });

  test('is never cached', () => {
    expect(GET().headers.get('Cache-Control')).toBe('no-store');
  });

  test('discloses nothing about the environment', async () => {
    // Values that must not leak even if someone later "helpfully" adds a
    // configured/version field to the payload.
    process.env.RESEND_API_KEY = 're_health_test_key';
    process.env.RELAY_SECRET = 'health-test-secret';

    const body = await GET().text();

    expect(body).not.toContain('re_health_test_key');
    expect(body).not.toContain('health-test-secret');
    // The shape is two constant strings, and nothing else.
    expect(Object.keys(JSON.parse(body))).toEqual(['status', 'service']);

    delete process.env.RESEND_API_KEY;
    delete process.env.RELAY_SECRET;
  });
});
