import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class SensitiveDataPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly patterns;
    run(context: ScanContext): Promise<PluginResult>;
    private maskSensitiveValue;
}
