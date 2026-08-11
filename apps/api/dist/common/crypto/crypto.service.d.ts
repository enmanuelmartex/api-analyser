import { ConfigService } from '@nestjs/config';
export declare class CryptoService {
    private readonly configService;
    private readonly logger;
    private readonly key;
    private static readonly VERSION;
    private static readonly IV_BYTES;
    private static readonly TAG_BYTES;
    constructor(configService: ConfigService);
    encrypt(plaintext: string): string;
    decrypt(encoded: string): string;
    isEncrypted(value: string | null | undefined): boolean;
    encryptIfNeeded(value: string): string;
    decryptIfNeeded(value: string | null | undefined): string | undefined;
    safeEquals(a: string, b: string): boolean;
}
