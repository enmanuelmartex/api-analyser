import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

/**
 * Global because the settings are read from modules that have no other reason
 * to depend on each other — the audit writer, the retention job, the scanner.
 * Threading an import through all of them buys nothing: there is one instance
 * either way, and this module deliberately depends on nothing but Prisma and
 * Config, so making it global cannot create a cycle.
 */
@Global()
@Module({
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
