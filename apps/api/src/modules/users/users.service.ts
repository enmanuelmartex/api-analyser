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
import { Resend } from 'resend';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { appBrand } from '../../brand/brand';

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

    await this.sendInvitationEmail(email, token, role, actorId).catch((err) => {
      this.logger.error(`Failed to send invitation email to ${email}: ${err.message}`);
    });

    this.audit.log({
      userId: actorId,
      action: 'CREATE',
      resource: 'invitation',
      resourceId: token.slice(0, 8),
      metadata: { email, role, resent: !!pending },
    });

    return { success: true, expiresAt, resent: !!pending };
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

  private async sendInvitationEmail(
    email: string,
    token: string,
    role: string,
    actorId: string,
  ) {
    const inviter    = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    const inviteLink  = `${frontendUrl}/accept-invite?token=${token}`;
    const apiKey      = this.config.get('RESEND_API_KEY');

    if (!apiKey) {
      this.logger.warn(`Resend not configured — invitation link for ${email}: ${inviteLink}`);
      return;
    }

    const from = this.config.get('RESEND_FROM', 'onboarding@resend.dev');
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from,
      to:      email,
      subject: `You've been invited to ${appBrand.name} by ${inviter?.name ?? 'an admin'}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#7c3aed">You're invited to ${appBrand.name}</h2>
          <p><strong>${inviter?.name ?? 'An admin'}</strong> has invited you to join their
          security workspace as <strong>${role}</strong>.</p>
          <p>
            <a href="${inviteLink}"
               style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;
                      text-decoration:none;display:inline-block;margin:16px 0;font-weight:600">
              Accept Invitation
            </a>
          </p>
          <p style="color:#666;font-size:13px">This invitation expires in 7 days.<br>
          If you didn't expect this, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) throw new Error(error.message);
    this.logger.log(`Invitation email sent to ${email} via Resend`);
  }
}
