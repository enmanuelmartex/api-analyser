import { Controller, Post, Get, Patch, Body, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
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
   * it real.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update the current user profile' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    const updated = await this.authService.updateProfile(user.id, dto);

    this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      resource: 'user',
      resourceId: user.id,
      metadata: { field: 'name' },
    });

    return updated;
  }
}
