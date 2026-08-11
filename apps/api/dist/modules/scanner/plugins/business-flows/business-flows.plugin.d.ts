import { BasePlugin, ScanContext, PluginResult } from '../../types/scanner.types';
import { PluginManifest } from '../../types/plugin-manifest.types';
export declare class BusinessFlowsPlugin extends BasePlugin {
    readonly manifest: PluginManifest;
    private readonly challengeFields;
    private readonly antiAutomationHeaders;
    private readonly idempotencyHeaders;
    run(context: ScanContext, pluginConfig?: Record<string, any>): Promise<PluginResult>;
    private probeBody;
    private baselineFor;
    private send;
    private declaredChallengeField;
    private declaredIdempotencyHeader;
    private countStatuses;
    private lowercaseKeys;
    private clamp;
    private capitalise;
}
