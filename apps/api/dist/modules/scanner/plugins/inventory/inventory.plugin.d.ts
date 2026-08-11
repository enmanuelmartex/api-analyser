import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class InventoryPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    run(context: ScanContext, pluginConfig?: Record<string, any>): Promise<PluginResult>;
    private planVersionProbes;
    private parseTarget;
    private probe;
    private nonce;
    private lowercaseKeys;
    private clamp;
    private result;
}
