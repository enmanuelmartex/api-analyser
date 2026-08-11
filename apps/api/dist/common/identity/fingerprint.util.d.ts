export declare const FINGERPRINT_VERSION = "v1";
export declare const GLOBAL_METHOD = "GLOBAL";
export declare const GLOBAL_ROUTE = "/";
export declare const GLOBAL_COMPONENT = "project";
export interface FingerprintParts {
    projectId: string;
    pluginId: string;
    ruleId: string;
    method: string;
    normalizedRoute: string;
    component: string;
}
export interface Fingerprint extends FingerprintParts {
    fingerprint: string;
    fingerprintVersion: string;
    canonical: string;
}
export interface FingerprintInput {
    projectId: string;
    pluginId: string;
    ruleId: string;
    method?: string | null;
    route?: string | null;
    component?: string | null;
}
export declare function normalizeMethod(method?: string | null): string;
export declare function normalizeRoute(route?: string | null): string;
export declare function normalizeComponent(component?: string | null): string;
export declare function buildCanonicalString(parts: FingerprintParts): string;
export declare function computeFingerprint(input: FingerprintInput): Fingerprint;
export declare function computeOccurrenceKey(fingerprintVersion: string, fingerprint: string): string;
