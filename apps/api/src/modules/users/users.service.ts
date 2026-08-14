import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { setBetterAuthPassword } from '../../lib/better-auth-credentials';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SELECT_PUBLIC = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatar: true,
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
   * any authenticated user, so it returns only what a picker renders — which
   * now includes `avatar`, the image the picker shows beside each name.
   * Inactive accounts are excluded — assigning work to a disabled account
   * silently parks the issue with nobody.
   */
  async findAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true, avatar: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateUserDto, actorId: string) {
    // Lowercased because Better Auth looks users up by `email.toLowerCase()` on
    // sign-in: an address stored with any capital letter is never found, and the
    // login form reports it as a wrong password.
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        password: passwordHash,
        role: dto.role ?? Role.ANALYST,
      },
      select: SELECT_PUBLIC,
    });

    // The credential the login form checks. Without it this account exists,
    // renders in the Users panel, and cannot log in.
    await setBetterAuthPassword(user.id, dto.password);

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

    // Both surfaces, or the reset silently only takes on the REST one and the
    // login form keeps accepting the old password.
    await setBetterAuthPassword(id, newPassword);

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

  // The email-invitation flow was removed. It never sent mail — this is
  // self-hosted software with no SMTP transport — so an invitation only ever
  // produced a link the administrator had to deliver by hand, which is strictly
  // more work than `create` above, and left a half-configured account in the
  // database until the invitee got round to it. Administrators create accounts
  // directly from Settings → Users.
}
