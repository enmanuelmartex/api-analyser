import { ProfilesService } from './profiles.service';
import { AuditService } from '../audit/audit.service';
import { CreateScanProfileDto, UpdateScanProfileDto } from './dto/scan-profile.dto';
export declare class ProfilesController {
    private readonly profilesService;
    private readonly audit;
    constructor(profilesService: ProfilesService, audit: AuditService);
    findAll(req: any): Promise<{
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
    findOne(id: string, req: any): Promise<{
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
    create(body: CreateScanProfileDto, req: any): Promise<{
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
    update(id: string, body: UpdateScanProfileDto, req: any): Promise<{
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
    remove(id: string, req: any): Promise<{
        deleted: boolean;
    }>;
}
