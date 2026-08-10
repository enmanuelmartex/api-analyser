import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemService } from './system.service';

@ApiTags('system')
@UseGuards(JwtAuthGuard)
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  /**
   * GET /system/info — runtime facts, installed checks and OWASP coverage.
   *
   * Authenticated but not admin-only: it reports capability, not configuration,
   * and every field is something a signed-in user can already infer from the
   * Security Checks screen. No secret, connection string or credential is
   * included.
   */
  @Get('info')
  getInfo() {
    return this.systemService.getInfo();
  }
}
