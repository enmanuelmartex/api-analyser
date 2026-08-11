#!/usr/bin/env node
/**
 * Creates a working `.env` for the from-source path.
 *
 * The API refuses to boot on a missing or placeholder secret, and `.env.example`
 * ships those three deliberately empty — a secret committed to a repository is a
 * public secret. The consequence was that the documented first run
 * (`cp .env.example .env && bun dev`) always failed with a validation error, and
 * the fix was three `openssl rand -hex 32` invocations nobody could guess from
 * the message.
 *
 * This fills them in. It generates with Node's CSPRNG rather than shelling out
 * to openssl, which is not on a default Windows machine.
 *
 * Refuses to overwrite an existing `.env`: it holds the key that decrypts stored
 * target credentials, and regenerating it silently would strand every one of
 * them. Pass --force if you mean it.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
const example = join(root, '.env.example');
const force = process.argv.includes('--force');

if (existsSync(target) && !force) {
  console.log('.env already exists — leaving it alone. Use --force to regenerate.');
  process.exit(0);
}

if (!existsSync(example)) {
  console.error('.env.example is missing; cannot generate .env from it.');
  process.exit(1);
}

copyFileSync(example, target);

/** 64 hex characters — the exact contract in apps/api/src/config/env.validation.ts. */
const secret = () => randomBytes(32).toString('hex');

const filled = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY', 'BETTER_AUTH_SECRET'];
let contents = readFileSync(target, 'utf8');

for (const key of filled) {
  // Only fills a variable that is present and empty; never overwrites a value.
  contents = contents.replace(new RegExp(`^${key}=\\s*$`, 'm'), `${key}=${secret()}`);
}

writeFileSync(target, contents);

console.log('Created .env from .env.example.');
console.log(`Generated: ${filled.join(', ')}.`);
console.log('DATABASE_URL and REDIS_URL point at the compose defaults — edit them if yours differ.');
