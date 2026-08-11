import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
import { ScanContext } from '../scanner/types/scanner.types';
export interface SinglePluginRunOptions {
    pluginId: string;
    projectId: string;
    userId: string;
    assessmentId?: string;
    pluginConfig?: Record<string, any>;
    timeoutMs?: number;
}
export interface SinglePluginRunResult {
    pluginId: string;
    pluginName: string;
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
    findingsCount: number;
    durationMs: number;
    findings: any[];
    error?: string;
    executionId: string;
}
export declare class PluginExecutorService {
    private readonly prisma;
    private readonly registry;
    private readonly logger;
    private readonly DEFAULT_TIMEOUT_MS;
    constructor(prisma: PrismaService, registry: PluginRegistryService);
    runSinglePlugin(options: SinglePluginRunOptions): Promise<SinglePluginRunResult>;
    executeInPipeline(plugin: import('../scanner/types/scanner.types').BasePlugin, context: ScanContext, userId: string, pluginConfig?: Record<string, any>): Promise<{
        findings: any[];
        durationMs: number;
        status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
    }>;
    private buildContext;
}
