import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScannerService } from './scanner.service';
import { ScannerProcessor } from './scanner.processor';
import { AiModule } from '../ai/ai.module';
import { PluginsModule } from '../plugins/plugins.module';
import { IssuesModule } from '../issues/issues.module';
import { ScoringModule } from '../scoring/scoring.module';

/**
 * No longer imports ReportsModule.
 *
 * The scan worker used to render the automatic PDF itself, which is why it
 * depended on the reports stack. That work now belongs to the `reports` queue,
 * driven by the `scan.completed` event, so the dependency is gone in the
 * direction that matters: reports know about scans, scans know nothing about
 * reports.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'scanner' }),
    AiModule,
    PluginsModule,
    IssuesModule,
    ScoringModule,
  ],
  providers: [ScannerService, ScannerProcessor],
  exports: [ScannerService],
})
export class ScannerModule {}
