export declare function indicatesLiveRoute(status: number): boolean;
export declare function versionSegmentOf(path: string): string | null;
export declare function siblingVersions(version: string, documented: ReadonlySet<string>, limit?: number): string[];
export declare function swapVersion(path: string, from: string, to: string): string;
export declare function nonProductionMarker(hostname: string): string | null;
export interface SurfaceProbe {
    path: string;
    label: string;
    matches: (body: string) => boolean;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    discloses: string;
}
export declare const DOCUMENTATION_PROBES: readonly SurfaceProbe[];
export declare const MANAGEMENT_PROBES: readonly SurfaceProbe[];
