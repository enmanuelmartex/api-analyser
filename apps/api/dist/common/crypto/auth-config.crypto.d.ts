import type { CryptoService } from './crypto.service';
export declare const ENCRYPTED_AUTH_FIELDS: readonly ["token", "password", "apiKey", "clientId", "clientSecret"];
export declare const SECRET_AUTH_FIELDS: readonly ["token", "password", "apiKey", "clientId", "clientSecret", "customHeaders"];
export declare function encryptAuthFields<T extends Record<string, any>>(crypto: CryptoService, authData: T): T;
export declare function decryptAuthFields<T extends Record<string, any>>(crypto: CryptoService, authConfig: T | null | undefined): T | null;
export declare function stripAuthSecrets<T extends Record<string, any>>(authConfig: T | null | undefined): Partial<T> | null | undefined;
