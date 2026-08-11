export interface ExternalUrlReference {
    url: string;
    host: string;
    insecure: boolean;
    provider: string | null;
}
export declare function identifyProvider(host: string): string | null;
export declare function extractExternalUrls(body: string, targetHost: string, limit?: number): ExternalUrlReference[];
export interface UpstreamErrorLeak {
    provider: string;
    host: string;
    errorToken: string;
}
export declare function detectUpstreamErrorLeak(body: string, targetHost: string): UpstreamErrorLeak | null;
export declare function webhookIntakeTerm(path: string, summary?: string): string | null;
export declare function declaredSignatureHeader(headerNames: string[]): string | null;
