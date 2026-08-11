import type { PluginManifest } from '../scanner/types/plugin-manifest.types';
export declare function findRuleDeclarationProblems(manifests: readonly PluginManifest[]): string[];
export declare function collectDeclaredRuleIds(manifests: readonly PluginManifest[]): Set<string>;
