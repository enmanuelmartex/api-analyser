"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvValidationError = exports.ENCRYPTION_KEY_BYTES = void 0;
exports.deriveEncryptionKey = deriveEncryptionKey;
exports.validateEnv = validateEnv;
const MIN_SECRET_LENGTH = 32;
exports.ENCRYPTION_KEY_BYTES = 32;
class EnvValidationError extends Error {
    constructor(problems) {
        super('Invalid environment configuration — refusing to start.\n\n' +
            problems.map((p) => `  • ${p}`).join('\n') +
            '\n\nSee .env.example for the required variables.\n' +
            'Generate strong values with:\n' +
            '  openssl rand -hex 32\n');
        this.name = 'EnvValidationError';
    }
}
exports.EnvValidationError = EnvValidationError;
const HEX_KEY_PATTERN = /^(?:hex:)?([0-9a-fA-F]{64})$/;
function deriveEncryptionKey(raw) {
    const match = HEX_KEY_PATTERN.exec(raw.trim());
    if (!match) {
        throw new EnvValidationError([describeInvalidEncryptionKey(raw)]);
    }
    const key = Buffer.from(match[1], 'hex');
    if (key.length !== exports.ENCRYPTION_KEY_BYTES) {
        throw new EnvValidationError([
            `ENCRYPTION_KEY decoded to ${key.length} bytes, expected ${exports.ENCRYPTION_KEY_BYTES}.`,
        ]);
    }
    return key;
}
function describeInvalidEncryptionKey(raw) {
    const value = raw.trim();
    const body = value.startsWith('hex:') ? value.slice(4) : value;
    const expected = `ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes), optionally ` +
        `prefixed with "hex:". Generate one with \`openssl rand -hex 32\`.`;
    if (body.length !== 64) {
        return `${expected} Received ${body.length} characters.`;
    }
    return `${expected} Received 64 characters, but they are not all hexadecimal.`;
}
function requireSecret(problems, env, name) {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`${name} is required but was not set.`);
        return;
    }
    if (value.length < MIN_SECRET_LENGTH) {
        problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (received ${value.length}).`);
        return;
    }
    if (/^fallback-/i.test(value) || /change-in-production/i.test(value)) {
        problems.push(`${name} still uses a placeholder value. Generate a real secret with \`openssl rand -hex 32\`.`);
    }
}
function extractFirstProblem(error) {
    const bullet = error.message
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('•'));
    return bullet ? bullet.replace(/^•\s*/, '') : 'ENCRYPTION_KEY is invalid.';
}
function validateEnv(env) {
    const problems = [];
    if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.trim() === '') {
        problems.push('DATABASE_URL is required but was not set.');
    }
    requireSecret(problems, env, 'JWT_SECRET');
    requireSecret(problems, env, 'REFRESH_TOKEN_SECRET');
    if (typeof env.ENCRYPTION_KEY !== 'string' || env.ENCRYPTION_KEY.trim() === '') {
        problems.push('ENCRYPTION_KEY is required but was not set. ' +
            'Generate one with `openssl rand -hex 32`.');
    }
    else {
        try {
            deriveEncryptionKey(env.ENCRYPTION_KEY);
        }
        catch (error) {
            problems.push(error instanceof EnvValidationError
                ? extractFirstProblem(error)
                : 'ENCRYPTION_KEY is invalid.');
        }
    }
    if (problems.length > 0)
        throw new EnvValidationError(problems);
    return env;
}
//# sourceMappingURL=env.validation.js.map