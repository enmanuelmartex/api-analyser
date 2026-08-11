import type { PluginManifest } from '../scanner/types/plugin-manifest.types';
export type OwaspCoverageStatus = 'COVERED' | 'NOT_COVERED';
export interface OwaspCategoryCoverage {
    id: string;
    shortId: string;
    title: string;
    description: string;
    status: OwaspCoverageStatus;
    checkIds: string[];
    checkNames: string[];
    ruleCount: number;
    gapReason?: string;
    scopeNote?: string;
}
export interface OwaspCoverageSummary {
    edition: '2023';
    categories: OwaspCategoryCoverage[];
    coveredCount: number;
    totalCount: number;
    label: string;
    checkCount: number;
    ruleCount: number;
}
interface CategoryDefinition {
    id: string;
    shortId: string;
    title: string;
    description: string;
    gapReason: string;
    scopeNote?: string;
}
export declare const OWASP_API_TOP_10_2023: readonly CategoryDefinition[];
export declare function computeOwaspCoverage(manifests: PluginManifest[]): OwaspCoverageSummary;
export {};
