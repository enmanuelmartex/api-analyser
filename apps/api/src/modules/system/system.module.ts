import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PluginsModule } from '../plugins/plugins.module';
import { SystemController } from './system.controller';
import { HealthController } from './health.controller';
import { SystemService } from './system.service';

@Module({
  imports: [PrismaModule, PluginsModule],
  controllers: [SystemController, HealthController],
  providers: [SystemService],
})
export class SystemModule {}
