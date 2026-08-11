"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const SELECT_PUBLIC = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
    lastLogin: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { projects: true } },
};
let UsersService = UsersService_1 = class UsersService {
    constructor(prisma, audit, config) {
        this.prisma = prisma;
        this.audit = audit;
        this.config = config;
        this.logger = new common_1.Logger(UsersService_1.name);
    }
    async findAll() {
        return this.prisma.user.findMany({
            select: SELECT_PUBLIC,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: SELECT_PUBLIC,
        });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async findAssignable() {
        return this.prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, email: true, role: true },
            orderBy: { name: 'asc' },
        });
    }
    async create(dto, actorId) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing)
            throw new common_1.ConflictException('Email already registered');
        const rounds = this.config.get('security.bcryptRounds', 12);
        const passwordHash = await bcrypt.hash(dto.password, rounds);
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                password: passwordHash,
                role: dto.role ?? client_1.Role.ANALYST,
            },
            select: SELECT_PUBLIC,
        });
        this.audit.log({
            userId: actorId,
            action: 'CREATE',
            resource: 'user',
            resourceId: user.id,
            metadata: { email: user.email, role: user.role },
        });
        return user;
    }
    async update(id, dto, actorId) {
        await this.findOne(id);
        const user = await this.prisma.user.update({
            where: { id },
            data: { name: dto.name },
            select: SELECT_PUBLIC,
        });
        this.audit.log({
            userId: actorId,
            action: 'UPDATE',
            resource: 'user',
            resourceId: id,
            metadata: { fields: Object.keys(dto) },
        });
        return user;
    }
    async changeRole(id, role, actorId) {
        const current = await this.findOne(id);
        if (current.id === actorId) {
            throw new common_1.BadRequestException('Cannot change your own role');
        }
        const user = await this.prisma.user.update({
            where: { id },
            data: { role },
            select: SELECT_PUBLIC,
        });
        this.audit.log({
            userId: actorId,
            action: 'ROLE_CHANGE',
            resource: 'user',
            resourceId: id,
            metadata: { from: current.role, to: role },
        });
        return user;
    }
    async setActive(id, isActive, actorId) {
        const current = await this.findOne(id);
        if (current.id === actorId) {
            throw new common_1.BadRequestException('Cannot disable your own account');
        }
        const user = await this.prisma.user.update({
            where: { id },
            data: { isActive },
            select: SELECT_PUBLIC,
        });
        this.audit.log({
            userId: actorId,
            action: 'UPDATE',
            resource: 'user',
            resourceId: id,
            metadata: { field: 'isActive', value: isActive },
        });
        return user;
    }
    async resetPassword(id, newPassword, actorId) {
        await this.findOne(id);
        const rounds = this.config.get('security.bcryptRounds', 12);
        const passwordHash = await bcrypt.hash(newPassword, rounds);
        await this.prisma.user.update({
            where: { id },
            data: { password: passwordHash },
        });
        this.audit.log({
            userId: actorId,
            action: 'PASSWORD_RESET',
            resource: 'user',
            resourceId: id,
        });
        return { success: true };
    }
    async remove(id, actorId) {
        if (id === actorId) {
            throw new common_1.BadRequestException('Cannot delete your own account');
        }
        const user = await this.findOne(id);
        await this.prisma.user.delete({ where: { id } });
        this.audit.log({
            userId: actorId,
            action: 'DELETE',
            resource: 'user',
            resourceId: id,
            metadata: { email: user.email },
        });
        return { success: true };
    }
    async sendInvitation(dto, actorId) {
        const email = dto.email.toLowerCase().trim();
        const role = dto.role ?? 'ANALYST';
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing)
            throw new common_1.ConflictException('A user with this email already exists');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const pending = await this.prisma.invitation.findFirst({
            where: { email, accepted: false },
        });
        let token;
        if (pending) {
            token = crypto.randomBytes(32).toString('hex');
            await this.prisma.invitation.update({
                where: { id: pending.id },
                data: { token, role, expiresAt, invitedById: actorId },
            });
        }
        else {
            token = crypto.randomBytes(32).toString('hex');
            await this.prisma.invitation.create({
                data: { email, role, token, invitedById: actorId, expiresAt },
            });
        }
        const inviteLink = this.buildInvitationLink(token);
        this.logger.log(`Invitation for ${email} (${role}): ${inviteLink}`);
        this.audit.log({
            userId: actorId,
            action: 'CREATE',
            resource: 'invitation',
            resourceId: token.slice(0, 8),
            metadata: { email, role, resent: !!pending },
        });
        return { success: true, expiresAt, resent: !!pending, inviteLink };
    }
    async verifyInvitation(token) {
        const invite = await this.prisma.invitation.findFirst({
            where: { token, accepted: false, expiresAt: { gt: new Date() } },
            include: { invitedBy: { select: { name: true, email: true } } },
        });
        if (!invite)
            throw new common_1.NotFoundException('Invitation not found or has expired');
        return {
            email: invite.email,
            role: invite.role,
            invitedBy: invite.invitedBy.name,
            expiresAt: invite.expiresAt,
        };
    }
    async acceptInvitation(token, userId) {
        const invite = await this.prisma.invitation.findFirst({
            where: { token, accepted: false, expiresAt: { gt: new Date() } },
        });
        if (!invite)
            throw new common_1.NotFoundException('Invitation not found or has expired');
        await this.prisma.user.update({
            where: { id: userId },
            data: { role: invite.role, ownerId: invite.invitedById },
        });
        await this.prisma.invitation.update({
            where: { id: invite.id },
            data: { accepted: true, acceptedAt: new Date() },
        });
        return { success: true };
    }
    buildInvitationLink(token) {
        const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
        return `${frontendUrl}/accept-invite?token=${token}`;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = UsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        config_1.ConfigService])
], UsersService);
//# sourceMappingURL=users.service.js.map