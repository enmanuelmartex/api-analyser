import {
  BadRequestException,
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { setBetterAuthPassword } from '../../lib/better-auth-credentials';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** The profile columns `PATCH /auth/me` is allowed to write. */
const PROFILE_FIELDS = [
  'name',
  'avatarColor',
  'timeZone',
  'dateFormat',
  'timeFormat',
  // Mirrored from the browser's own theme store so the email pipeline, which
  // renders server-side, can pick the light or dark variant of a message.
  'theme',
] as const;

/**
 * The subset of a profile PATCH that was actually asked for.
 *
 * Keys the request omitted are dropped; keys it sent as `null` are kept, because
 * null is a value here — "clear my choice" — and not the absence of one. Empty
 * strings are normalised to null so a cleared select and an unset one are the
 * same state in the database rather than two spellings of it.
 *
 * Exported so the controller can name the changed fields in the audit record
 * without re-deriving the rule and drifting from it.
 */
export function profileChanges(dto: UpdateProfileDto): Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>> {
  const changes: Record<string, string | null> = {};

  for (const field of PROFILE_FIELDS) {
    const value = dto[field];
    if (value === undefined) continue;
    // `name` can never be null — the DTO rejects it — so this only ever nulls a
    // preference column.
    changes[field] = value === null || value === '' ? null : value;
  }

  return changes;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Self-registration always creates an ADMIN owner.
    // Analysts are created by Admins from the Users panel, never via self-register.
    const role = 'ADMIN';

    const rounds = this.configService.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        password: passwordHash,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // The credential the login form checks — this endpoint writes only the
    // bcrypt hash its own `login` reads, so without this an account registered
    // over REST cannot sign in through the web UI.
    await setBetterAuthPassword(user.id, dto.password);

    this.logger.log(`New user registered: ${user.email}`);

    this.audit.log({
      userId: user.id,
      action: 'CREATE',
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email, source: 'self-register' },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    /*
     * Failed sign-ins are recorded as well as successful ones — a login wall
     * with no record of the attempts against it tells an investigator nothing.
     * The reason is kept in metadata so "no such account" is distinguishable
     * from "wrong password" in the audit trail, while the response to the
     * client stays a single indistinguishable message: telling an attacker
     * which addresses exist is exactly what the uniform error prevents.
     *
     * The submitted password is never touched here, not even to record its
     * length.
     */
    if (!user || !user.isActive) {
      this.recordFailedLogin(email, user ? 'account_inactive' : 'unknown_account', user?.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      this.recordFailedLogin(email, 'no_password_set', user.id);
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      this.recordFailedLogin(email, 'bad_password', user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    this.logger.log(`User logged in: ${user.email}`);

    void this.audit.record({
      event: 'auth.login.succeeded',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      status: 'SUCCESS',
      action: 'LOGIN',
      resource: 'auth',
      resourceId: user.id,
      userId: user.id,
      source: 'api',
      message: `${user.email} signed in`,
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      ...tokens,
    };
  }

  /**
   * Records a rejected sign-in.
   *
   * WARNING rather than ERROR: a mistyped password is normal operation, and
   * raising it to ERROR would bury genuine faults in the severity filter. It is
   * still in the AUTHENTICATION category, which is always collected, so these
   * survive the log-collection switch being turned off.
   */
  private recordFailedLogin(email: string, reason: string, userId?: string) {
    void this.audit.record({
      event: 'auth.login.failed',
      category: 'AUTHENTICATION',
      severity: 'WARNING',
      status: 'FAILED',
      action: 'LOGIN',
      resource: 'auth',
      resourceId: userId,
      userId,
      source: 'api',
      message: `Failed sign-in attempt for ${email}`,
      errorCode: reason,
      metadata: { email, reason },
    });
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        // Display preferences travel with the identity rather than on a route of
        // their own: the client already fetches `me` before it renders anything,
        // and a second request would mean the first timestamps paint in the
        // wrong format and then move.
        avatarColor: true,
        timeZone: true,
        dateFormat: true,
        timeFormat: true,
        theme: true,
        lastLogin: true,
        createdAt: true,
      },
    });
  }

  /**
   * Updates the caller's own profile.
   *
   * Scoped to the authenticated id — the id is never taken from the request
   * body, so this cannot be pointed at another account. Returns the same shape
   * as `me()` so the client can replace its cached user directly.
   *
   * A partial update in the strict sense: only keys actually present in the
   * request reach Prisma. Spreading the DTO wholesale would send `name:
   * undefined` for a preferences-only PATCH — harmless with Prisma, but it also
   * sends `timeZone: undefined` for a rename, and the moment anything here
   * grows a `null`-vs-missing distinction that becomes a silent data loss. The
   * distinction is kept explicit instead: absent means untouched, `null` means
   * cleared back to the default.
   */
  async updateProfile(userId: string, data: UpdateProfileDto) {
    const changes = profileChanges(data);

    // Nothing to write. Still returns the current profile so the caller's
    // "replace my cached user with the response" path holds for every request.
    if (Object.keys(changes).length === 0) return this.me(userId);

    await this.prisma.user.update({ where: { id: userId }, data: changes });

    return this.me(userId);
  }

  /**
   * Changes the caller's own password.
   *
   * Settings → Security previously rendered this form, validated it in the
   * browser, raised "Password changed successfully" and wrote nothing — the
   * user's password was unchanged and they had been told otherwise.
   *
   * Writes both credential stores, exactly as `UsersService.resetPassword`
   * does: the REST login path reads `users.password` while the login form goes
   * through Better Auth's account record, and updating only one leaves the old
   * password still working on the other.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account not found');

    // An account created through Better Auth alone has no local hash. Verifying
    // against the account record instead is a larger change than this fix
    // warrants, so it is refused explicitly rather than silently allowed
    // through without a current-password check.
    if (!user.password) {
      throw new BadRequestException(
        'This account has no local password set. Ask an administrator to reset it.',
      );
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      void this.audit.record({
        event: 'auth.password.change_failed',
        category: 'AUTHENTICATION',
        severity: 'WARNING',
        status: 'FAILED',
        resource: 'auth',
        resourceId: userId,
        userId,
        source: 'api',
        message: 'Password change rejected: current password did not match',
        errorCode: 'bad_current_password',
      });
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }

    const rounds = this.configService.get<number>('security.bcryptRounds', 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(newPassword, rounds) },
    });
    await setBetterAuthPassword(userId, newPassword);

    void this.audit.record({
      event: 'auth.password.changed',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      status: 'SUCCESS',
      action: 'PASSWORD_RESET',
      resource: 'auth',
      resourceId: userId,
      userId,
      source: 'api',
      message: `${user.email} changed their password`,
    });

    return { success: true };
  }

  async exchangeSession(sessionToken: string) {
    const session = await (this.prisma as any).session.findFirst({
      where: { token: sessionToken, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException('Invalid or expired session');

    const user = session.user as any;
    if (!user.isActive) throw new UnauthorizedException('Account is inactive');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    }).catch(() => {});

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiresIn', '7d'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '30d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
