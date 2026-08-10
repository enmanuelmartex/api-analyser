import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PluginsModule } from '../plugins/plugins.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [PrismaModule, PluginsModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
