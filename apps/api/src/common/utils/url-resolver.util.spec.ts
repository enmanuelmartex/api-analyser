import { BadRequestException } from '@nestjs/common';
import { assertSafeRemoteUrl } from './url-resolver.util';

describe('assertSafeRemoteUrl', () => {
  const original = process.env.ALLOW_PRIVATE_TARGETS;
  afterEach(() => { process.env.ALLOW_PRIVATE_TARGETS = original; });

  it.each(['file:///etc/passwd', 'ftp://example.com/spec.json', 'http://user:pass@example.com'])('rejects unsafe URL %s', async (url) => {
    // Scheme and credentials are refused whatever the private-target policy is:
    // allowing a private network is not permission to speak a different protocol.
    await expect(assertSafeRemoteUrl(url, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['http://127.0.0.1/spec.json', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/openapi.json'])('rejects private address %s when private targets are off', async (url) => {
    await expect(assertSafeRemoteUrl(url, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    'http://127.0.0.1:8080/openapi.json',
    'http://localhost:8000/openapi.json',
  ])('allows private target %s when the setting permits it', async (url) => {
    await expect(assertSafeRemoteUrl(url, true)).resolves.toBe(url);
  });

  it('falls back to the environment when the caller passes no policy', async () => {
    // The default exists for call sites with no SettingsService. It must read
    // the env var, and it must not be permissive when the var is absent.
    delete process.env.ALLOW_PRIVATE_TARGETS;
    await expect(assertSafeRemoteUrl('http://10.0.0.1/openapi.json')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    process.env.ALLOW_PRIVATE_TARGETS = 'true';
    await expect(assertSafeRemoteUrl('http://10.0.0.1/openapi.json')).resolves.toBe(
      'http://10.0.0.1/openapi.json',
    );
  });
});
