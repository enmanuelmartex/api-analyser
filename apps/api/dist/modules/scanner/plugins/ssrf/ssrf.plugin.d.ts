import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class SsrfPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly ssrfPayloads;
    private readonly urlParamNames;
    run(context: ScanContext): Promise<PluginResult>;
}
