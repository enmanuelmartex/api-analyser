import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
interface LogParams {
    userId?: string;
    action: AuditAction;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
}
export declare class AuditService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    log(params: LogParams): void;
    findAll(opts?: {
        userId?: string;
        action?: AuditAction;
        resource?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        total: number;
        items: ({
            user: {
                id: string;
                name: string;
                email: string;
            };
        } & {
            id: string;
            action: import("@prisma/client").$Enums.AuditAction;
            resource: string;
            resourceId: string | null;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            ipAddress: string | null;
            userAgent: string | null;
            success: boolean;
            createdAt: Date;
            userId: string | null;
        })[];
    }>;
}
export {};
