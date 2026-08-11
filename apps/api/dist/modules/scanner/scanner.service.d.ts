import { ScanContext, ScanFinding, BasePlugin } from './types/scanner.types';
import { AiService } from '../ai/ai.service';
import type { AiAnalysisMeta } from '../ai/interfaces/ai-provider.interface';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { PluginExecutorService } from '../plugins/plugin-executor.service';
type ProgressCallback = (progress: any) => void;
type LogCallback = (entry: {
    level: string;
    plugin: string;
    message: string;
}) => void;
export interface PluginExecutionPlan {
    available: string[];
    executed: string[];
    failed: string[];
    skipped: string[];
    skippedReason: Record<string, string>;
    versions: Record<string, string>;
    durationMs: Record<string, number>;
    findingCounts: Record<string, number>;
}
export interface ScanRunResult {
    findings: ScanFinding[];
    pluginPlan: PluginExecutionPlan;
    aiMeta: AiAnalysisMeta;
}
export declare class ScannerService {
    private readonly aiService;
    private readonly pluginRegistry;
    private readonly pluginExecutor;
    private readonly logger;
    constructor(aiService: AiService, pluginRegistry: PluginRegistryService, pluginExecutor: PluginExecutorService);
    runAllPlugins(context: ScanContext, onProgress: ProgressCallback, onLog: LogCallback, userId?: string, pluginOverride?: BasePlugin[]): Promise<ScanRunResult>;
}
export {};
