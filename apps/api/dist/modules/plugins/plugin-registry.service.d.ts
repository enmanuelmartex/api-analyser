import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BasePlugin } from '../scanner/types/scanner.types';
import { PluginManifest } from '../scanner/types/plugin-manifest.types';
import { type OwaspCoverageSummary } from './owasp-coverage';
export interface PluginWithMeta {
    plugin: BasePlugin;
    manifest: PluginManifest;
}
export declare function createBuiltinPlugins(): BasePlugin[];
export declare class PluginRegistryService implements OnModuleInit {
    private readonly prisma;
    private readonly logger;
    private readonly registry;
    private declaredRuleIds;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    private validateRuleDeclarations;
    isDeclaredRule(pluginId: string, ruleId: string): boolean;
    getDeclaredRuleIds(): ReadonlySet<string>;
    register(plugin: BasePlugin): void;
    private registerBuiltins;
    private syncToDatabase;
    private toPrismaCategory;
    getAll(): BasePlugin[];
    getById(id: string): BasePlugin | undefined;
    getAllManifests(): PluginManifest[];
    getOwaspCoverage(): OwaspCoverageSummary;
    has(id: string): boolean;
    getEnabledForUser(userId: string): Promise<BasePlugin[]>;
    getEnabledGlobally(): Promise<BasePlugin[]>;
    getByIds(pluginIds: string[]): BasePlugin[];
    getPluginConfig(pluginId: string, userId: string): Promise<Record<string, any>>;
}
