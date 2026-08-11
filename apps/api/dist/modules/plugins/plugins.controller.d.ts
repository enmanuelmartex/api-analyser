import { PluginsService } from './plugins.service';
import { PluginExecutorService } from './plugin-executor.service';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginCategory } from '../scanner/types/plugin-manifest.types';
export declare class PluginsController {
    private readonly pluginsService;
    private readonly executor;
    private readonly registry;
    constructor(pluginsService: PluginsService, executor: PluginExecutorService, registry: PluginRegistryService);
    findAll(req: any): Promise<{
        isEnabled: boolean;
        userConfig: Record<string, any>;
        stats: {
            totalExecutions: number;
            avgDurationMs: number;
        };
        id: string;
        createdAt: Date;
        name: string;
        updatedAt: Date;
        description: string;
        tags: string[];
        version: string;
        license: string;
        permissions: string[];
        longDescription: string | null;
        author: string;
        category: import("@prisma/client").$Enums.PluginCategory;
        owaspMappings: string[];
        cweIds: string[];
        isBuiltin: boolean;
        configSchema: import("@prisma/client/runtime/library").JsonValue | null;
        defaultConfig: import("@prisma/client/runtime/library").JsonValue | null;
        documentationUrl: string | null;
        changelog: string | null;
        minimumCoreVersion: string;
    }[]>;
    getCategories(): PluginCategory[];
    getOwaspCoverage(): import("./owasp-coverage").OwaspCoverageSummary;
    findOne(id: string, req: any): Promise<{
        isEnabled: boolean;
        userConfig: Record<string, any>;
        stats: {
            totalExecutions: number;
            successRate: number;
            avgDurationMs: number;
            findingsBySeverity: {
                [k: string]: number;
            };
        };
        recentExecutions: {
            id: string;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            createdAt: Date;
            userId: string;
            status: import("@prisma/client").$Enums.PluginExecutionStatus;
            completedAt: Date | null;
            startedAt: Date;
            assessmentId: string | null;
            pluginId: string;
            durationMs: number | null;
            findingsCount: number;
            errorMessage: string | null;
        }[];
        id: string;
        createdAt: Date;
        name: string;
        updatedAt: Date;
        description: string;
        tags: string[];
        version: string;
        license: string;
        permissions: string[];
        longDescription: string | null;
        author: string;
        category: import("@prisma/client").$Enums.PluginCategory;
        owaspMappings: string[];
        cweIds: string[];
        isBuiltin: boolean;
        configSchema: import("@prisma/client/runtime/library").JsonValue | null;
        defaultConfig: import("@prisma/client/runtime/library").JsonValue | null;
        documentationUrl: string | null;
        changelog: string | null;
        minimumCoreVersion: string;
    }>;
    toggle(id: string, body: {
        isEnabled: boolean;
    }, req: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        updatedAt: Date;
        config: import("@prisma/client/runtime/library").JsonValue | null;
        pluginId: string;
        isEnabled: boolean;
    }>;
    saveConfig(id: string, body: Record<string, any>, req: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        updatedAt: Date;
        config: import("@prisma/client/runtime/library").JsonValue | null;
        pluginId: string;
        isEnabled: boolean;
    }>;
    getExecutions(id: string, req: any): Promise<{
        id: string;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        createdAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.PluginExecutionStatus;
        completedAt: Date | null;
        startedAt: Date;
        assessmentId: string | null;
        pluginId: string;
        durationMs: number | null;
        findingsCount: number;
        errorMessage: string | null;
    }[]>;
    getIssues(id: string, req: any): Promise<({
        project: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string;
        title: string;
        method: string;
        status: import("@prisma/client").$Enums.IssueStatus;
        projectId: string;
        severity: import("@prisma/client").$Enums.Severity;
        pluginId: string;
        ruleId: string;
        fingerprint: string;
        normalizedRoute: string;
        component: string;
        fingerprintVersion: string;
        owaspCategory: string;
        cweId: string | null;
        cvssScore: number | null;
        cvssVector: string | null;
        notes: string | null;
        assigneeId: string | null;
        acceptedRiskUntil: Date | null;
        firstSeenAt: Date;
        lastSeenAt: Date;
        resolvedAt: Date | null;
        reopenedAt: Date | null;
        reopenCount: number;
        occurrenceCount: number;
    })[]>;
    runPlugin(pluginId: string, body: {
        projectId: string;
        pluginConfig?: Record<string, any>;
        timeoutMs?: number;
    }, req: any): Promise<import("./plugin-executor.service").SinglePluginRunResult>;
}
