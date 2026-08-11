import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: SELECT_PUBLIC,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SELECT_PUBLIC,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Accounts that may be set as an issue assignee.
   *
   * A narrower projection than `SELECT_PUBLIC` on purpose: this is reachable by
   * any authenticated user, so it returns only what a picker renders. Inactive
   * accounts are excluded — assigning work to a disabled account silently
   * parks the issue with nobody.
   */
  async findAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: passwordHash,
        role: dto.role ?? Role.ANALYST,
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

  async update(id: string, dto: UpdateUserDto, actorId: string) {
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

  async changeRole(id: string, role: Role, actorId: string) {
    const current = await this.findOne(id);
    if (current.id === actorId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      select: SELECT_PUBLIC,
    });

    this.audit.log({
      userId: actorId,
      action: 'ROLE_CHANGE' as any,
      resource: 'user',
      resourceId: id,
      metadata: { from: current.role, to: role },
    });

    return user;
  }

  async setActive(id: string, isActive: boolean, actorId: string) {
    const current = await this.findOne(id);
    if (current.id === actorId) {
      throw new BadRequestException('Cannot disable your own account');
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

  async resetPassword(id: string, newPassword: string, actorId: string) {
    await this.findOne(id);
    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(newPassword, rounds);

    await this.prisma.user.update({
      where: { id },
      data: { password: passwordHash },
    });

    this.audit.log({
      userId: actorId,
      action: 'PASSWORD_RESET' as any,
      resource: 'user',
      resourceId: id,
    });

    return { success: true };
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('Cannot delete your own account');
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

  // ── Invitation system ─────────────────────────────────────────────────────────

  async sendInvitation(dto: { email: string; role?: string }, actorId: string) {
    const email = dto.email.toLowerCase().trim();
    const role  = dto.role ?? 'ANALYST';

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // If a pending invite exists, renew it and resend instead of erroring
    const pending = await (this.prisma as any).invitation.findFirst({
      where: { email, accepted: false },
    });

    let token: string;
    if (pending) {
      token = crypto.randomBytes(32).toString('hex');
      await (this.prisma as any).invitation.update({
        where: { id: pending.id },
        data: { token, role, expiresAt, invitedById: actorId },
      });
    } else {
      token = crypto.randomBytes(32).toString('hex');
      await (this.prisma as any).invitation.create({
        data: { email, role, token, invitedById: actorId, expiresAt },
      });
    }

    const inviteLink = this.buildInvitationLink(token);

    // Logged as well as returned: an admin who closes the dialog before copying
    // the link would otherwise have to revoke the invitation and issue a new one.
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

  async verifyInvitation(token: string) {
    const invite = await (this.prisma as any).invitation.findFirst({
      where: { token, accepted: false, expiresAt: { gt: new Date() } },
      include: { invitedBy: { select: { name: true, email: true } } },
    });
    if (!invite) throw new NotFoundException('Invitation not found or has expired');

    return {
      email:     invite.email,
      role:      invite.role,
      invitedBy: invite.invitedBy.name,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvitation(token: string, userId: string) {
    const invite = await (this.prisma as any).invitation.findFirst({
      where: { token, accepted: false, expiresAt: { gt: new Date() } },
    });
    if (!invite) throw new NotFoundException('Invitation not found or has expired');

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: invite.role as Role, ownerId: invite.invitedById },
    });

    await (this.prisma as any).invitation.update({
      where: { id: invite.id },
      data: { accepted: true, acceptedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Where an invited user goes to set their password.
   *
   * There is no mail transport here on purpose. This is self-hosted software an
   * operator runs on their own network — often one with no outbound SMTP and no
   * account with an email provider — so requiring a third-party API key before
   * a second user can exist would put a hosted dependency in the middle of a
   * local install. The link is returned to the admin who created the invitation
   * and written to the log; how it reaches the invitee is their call.
   */
  private buildInvitationLink(token: string): string {
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    return `${frontendUrl}/accept-invite?token=${token}`;
  }
}
