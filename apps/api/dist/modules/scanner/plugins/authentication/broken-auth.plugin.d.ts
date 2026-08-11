import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class BrokenAuthPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    run(context: ScanContext): Promise<PluginResult>;
}
