import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Liveness and readiness for the API container.
 *
 * `GET /api/v1/health` has been referenced from three places since before it
 * existed — the Dockerfile's HEALTHCHECK, the CI workflow's "Wait for API" gate,
 * and every deployment guide — and all three were polling a 404. The production
 * image reported `unhealthy` for its whole life, and the CI job sat in a retry
 * loop until its timeout and failed the run.
 *
 * Two endpoints, because they answer different questions:
 *
 *  - `/health` is liveness: the process is up and serving. It touches nothing
 *    else, so an orchestrator will not restart a healthy API because its
 *    database blipped.
 *  - `/health/ready` is readiness: the dependencies this process needs are
 *    actually reachable. It is the one to gate traffic on.
 *
 * Both are `@Public()`. A probe that needs a credential is a probe that reports
 * an outage when the credential expires.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — the process is up and serving requests' })
  live() {
    return {
      status: 'ok',
      service: 'api',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — dependencies are reachable' })
  async ready() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      // Reported, never thrown: the point of this endpoint is to answer.
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
