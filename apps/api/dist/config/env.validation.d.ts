export declare const ENCRYPTION_KEY_BYTES = 32;
export declare class EnvValidationError extends Error {
    constructor(problems: string[]);
}
export declare function deriveEncryptionKey(raw: string): Buffer;
export declare function validateEnv(env: Record<string, unknown>): Record<string, unknown>;
