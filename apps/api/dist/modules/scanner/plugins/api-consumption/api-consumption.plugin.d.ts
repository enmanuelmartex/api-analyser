import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class ApiConsumptionPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    run(context: ScanContext, pluginConfig?: Record<string, any>): Promise<PluginResult>;
    private nonexistentUrl;
    private send;
    private hostOf;
    private lowercaseKeys;
    private clamp;
    private result;
}
