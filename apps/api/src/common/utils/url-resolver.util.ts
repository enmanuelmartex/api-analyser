import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const IS_DOCKER = process.env.DOCKER_ENV === 'true';

const LOCALHOST_PATTERN = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?/;

/**
 * Rewrites localhost/127.0.0.1 → host.docker.internal when running inside Docker.
 * On the host machine this is a no-op.
 */
export function resolveTargetUrl(url: string): string {
  if (!IS_DOCKER) return url;
  return url.replace(LOCALHOST_PATTERN, '$1host.docker.internal$3');
}

/**
 * Validates user-controlled outbound URLs before any request is made.
 *
 * `allowPrivate` is passed in rather than read here, because the effective
 * policy is the `scanner.allowPrivateTargets` setting — an administrator can
 * change it at runtime, and a module-level read of `process.env` would keep
 * enforcing whatever was true when the process booted. Callers that have no
 * settings access omit it and get the environment default; the only thing that
 * must never happen is defaulting to permissive when nothing said so.
 */
export async function assertSafeRemoteUrl(
  value: string,
  allowPrivate = process.env.ALLOW_PRIVATE_TARGETS === 'true',
): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Enter a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('Only credential-free HTTP and HTTPS URLs are allowed.');
  }
  if (allowPrivate) return url.toString();

  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('The URL hostname could not be resolved.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new BadRequestException('Private, loopback, link-local and reserved network targets are not allowed.');
  }
  return url.toString();
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (normalized.includes(':')) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('2001:db8:');
  }
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0);
}
