import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginsService } from './plugins.service';
import { PluginExecutorService } from './plugin-executor.service';
import { ProfilesService } from './profiles.service';
import { PluginsController } from './plugins.controller';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    PluginRegistryService,
    PluginsService,
    PluginExecutorService,
    ProfilesService,
  ],
  // Static /plugins/profiles routes must be registered before /plugins/:id.
  controllers: [ProfilesController, PluginsController],
  exports: [PluginRegistryService, PluginExecutorService],
})
export class PluginsModule {}
