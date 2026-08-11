import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
interface CreateProfileDto {
    name: string;
    description?: string;
    icon?: string;
    enabledPlugins: string[];
    pluginConfigs?: Record<string, any>;
}
export declare const SYSTEM_PROFILES: {
    id: string;
    name: string;
    description: string;
    icon: string;
    enabledPlugins: string[];
}[];
export declare class ProfilesService implements OnModuleInit {
    private readonly prisma;
    private readonly registry;
    constructor(prisma: PrismaService, registry: PluginRegistryService);
    private assertChecksExist;
    onModuleInit(): Promise<void>;
    private seedSystemProfiles;
    findAll(userId: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        name: string;
        updatedAt: Date;
        description: string | null;
        icon: string | null;
        isSystem: boolean;
        enabledPlugins: string[];
        pluginConfigs: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    findOne(profileId: string, userId: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        name: string;
        updatedAt: Date;
        description: string | null;
        icon: string | null;
        isSystem: boolean;
        enabledPlugins: string[];
        pluginConfigs: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    create(userId: string, dto: CreateProfileDto): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        name: string;
        updatedAt: Date;
        description: string | null;
        icon: string | null;
        isSystem: boolean;
        enabledPlugins: string[];
        pluginConfigs: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    update(profileId: string, userId: string, dto: Partial<CreateProfileDto>): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        name: string;
        updatedAt: Date;
        description: string | null;
        icon: string | null;
        isSystem: boolean;
        enabledPlugins: string[];
        pluginConfigs: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    remove(profileId: string, userId: string): Promise<{
        deleted: boolean;
    }>;
}
export {};
