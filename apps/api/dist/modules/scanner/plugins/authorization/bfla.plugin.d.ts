import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class BflaPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly adminPaths;
    private readonly adminOperations;
    run(context: ScanContext): Promise<PluginResult>;
}
