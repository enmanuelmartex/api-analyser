import { Controller, Post, Get, Patch, Body, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuditAction } from '@prisma/client';
import { AuthService, profileChanges } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AccountRateLimitGuard } from '../../common/throttler/account-rate-limit.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
  ) {}

  /*
   * Public by design — registration necessarily happens before an account, and
   * therefore a session, exists. What has to guard this route is not an
   * authentication requirement (there is nothing to authenticate against yet)
   * but anti-automation: the `short` throttler bucket is tightened here from
   * its app-wide 20-per-second default to 3 per 5 minutes per IP, catching
   * bulk account creation without touching legitimate signups.
   */
  @Public()
  @Throttle({ short: { limit: 3, ttl: 300_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /*
   * Public by design — a login endpoint that required a prior session could
   * never be used to obtain one. Do not add an authentication guard here; the
   * defence against brute force and credential stuffing is the pair of
   * throttles below instead:
   *
   *   - `@Throttle` tightens the per-IP `short` bucket to 5/minute, well below
   *     its 20/second app-wide default.
   *   - `AccountRateLimitGuard` adds a second, independent counter keyed by
   *     the submitted email rather than the caller's IP, so credential
   *     stuffing spread across many addresses against one account is caught
   *     even though no single IP crosses the limit above.
   *
   * `AuthService.login` is also responsible for not distinguishing "no such
   * account" from "wrong password" in its response, which is the other half
   * of not helping an attacker — rate limiting slows the guess, a generic
   * message stops it from confirming which accounts exist.
   */
  @Public()
  @UseGuards(AccountRateLimitGuard)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('exchange-session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a Better Auth session token for a JWT' })
  async exchangeSession(@Body('token') token: string) {
    if (!token) throw new BadRequestException('Session token is required');
    return this.authService.exchangeSession(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@CurrentUser() user: any) {
    return this.authService.me(user.id);
  }

  /**
   * PATCH /auth/me — self-service profile update.
   *
   * Exists because every `/users` route is admin-gated, so a non-admin had no
   * way to change their own display name. Settings → General offered a "Save
   * changes" button that only raised a toast; this is the endpoint that makes
   * it real. It now carries the display preferences too — avatar colour,
   * timezone and date/time format — which were the same kind of control:
   * selects backed by React state that reset on reload.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update the current user profile' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    const updated = await this.authService.updateProfile(user.id, dto);

    /*
     * The changed field names, not a hardcoded `'name'`.
     *
     * Derived from the same function that decides what gets written, so the log
     * cannot claim a rename that did not happen — which is what it did for
     * every request once this endpoint accepted more than one field. Names
     * only: the values are display preferences, but an audit trail that records
     * what an account looks at is a habit worth not starting.
     */
    const fields = Object.keys(profileChanges(dto));
    if (fields.length > 0) {
      this.audit.log({
        userId: user.id,
        action: AuditAction.UPDATE,
        resource: 'user',
        resourceId: user.id,
        metadata: { fields },
      });
    }

    return updated;
  }

  /**
   * POST /auth/change-password — self-service password change.
   *
   * The audit events are written inside the service, not here, because both the
   * success and the rejected-current-password cases are worth recording and only
   * the service can tell them apart.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Change the current user password' })
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
