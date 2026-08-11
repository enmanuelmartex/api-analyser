import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { InviteUserDto } from './dto/invite-user.dto';
export declare class UsersController {
    private users;
    private audit;
    constructor(users: UsersService, audit: AuditService);
    findAll(): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }[]>;
    getAuditLogs(limit: number, offset: number, userId?: string, action?: string, resource?: string): Promise<{
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
    invite(dto: InviteUserDto, actor: any): Promise<{
        success: boolean;
        expiresAt: Date;
        resent: boolean;
        inviteLink: string;
    }>;
    listAssignable(): Promise<{
        id: string;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
    }[]>;
    verifyInvite(token: string): Promise<{
        email: any;
        role: any;
        invitedBy: any;
        expiresAt: any;
    }>;
    acceptInvite(token: string, user: any): Promise<{
        success: boolean;
    }>;
    findOne(id: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }>;
    create(dto: CreateUserDto, actor: any): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }>;
    update(id: string, dto: UpdateUserDto, actor: any): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }>;
    changeRole(id: string, dto: ChangeRoleDto, actor: any): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }>;
    setStatus(id: string, dto: SetStatusDto, actor: any): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date;
        updatedAt: Date;
        _count: {
            projects: number;
        };
    }>;
    resetPassword(id: string, dto: ResetPasswordDto, actor: any): Promise<{
        success: boolean;
    }>;
    remove(id: string, actor: any): Promise<{
        success: boolean;
    }>;
}
