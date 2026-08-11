import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class MassAssignmentPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly privilegedFields;
    run(context: ScanContext): Promise<PluginResult>;
}
