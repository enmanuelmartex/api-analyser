import { Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersService {
    private prisma;
    private audit;
    private config;
    private readonly logger;
    constructor(prisma: PrismaService, audit: AuditService, config: ConfigService);
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
    findAssignable(): Promise<{
        id: string;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
    }[]>;
    create(dto: CreateUserDto, actorId: string): Promise<{
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
    update(id: string, dto: UpdateUserDto, actorId: string): Promise<{
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
    changeRole(id: string, role: Role, actorId: string): Promise<{
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
    setActive(id: string, isActive: boolean, actorId: string): Promise<{
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
    resetPassword(id: string, newPassword: string, actorId: string): Promise<{
        success: boolean;
    }>;
    remove(id: string, actorId: string): Promise<{
        success: boolean;
    }>;
    sendInvitation(dto: {
        email: string;
        role?: string;
    }, actorId: string): Promise<{
        success: boolean;
        expiresAt: Date;
        resent: boolean;
        inviteLink: string;
    }>;
    verifyInvitation(token: string): Promise<{
        email: any;
        role: any;
        invitedBy: any;
        expiresAt: any;
    }>;
    acceptInvitation(token: string, userId: string): Promise<{
        success: boolean;
    }>;
    private buildInvitationLink;
}
