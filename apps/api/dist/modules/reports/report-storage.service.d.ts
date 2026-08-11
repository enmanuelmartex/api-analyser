export declare class ReportStorageService {
    private readonly logger;
    private readonly storageRoot;
    constructor();
    private resolveWithinRoot;
    static checksum(bytes: Buffer | string): string;
    write(fileName: string, bytes: Buffer): Promise<string | null>;
    read(fileName: string): Promise<Buffer | null>;
    delete(fileName: string | null | undefined): Promise<void>;
}
