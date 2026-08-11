import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class CorsPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly testOrigins;
    run(context: ScanContext): Promise<PluginResult>;
}
