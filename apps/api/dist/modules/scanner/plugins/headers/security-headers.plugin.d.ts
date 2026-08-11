import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class SecurityHeadersPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly checks;
    run(context: ScanContext): Promise<PluginResult>;
}
