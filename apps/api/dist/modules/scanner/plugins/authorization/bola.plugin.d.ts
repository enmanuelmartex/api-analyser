import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class BolaPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly idPatterns;
    run(context: ScanContext): Promise<PluginResult>;
    private containsUserData;
}
