import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';
import { AutoReportService, REPORTS_QUEUE } from './auto-report.service';
import { ReportsProcessor } from './reports.processor';
import { ReportsAutoListener } from './reports-auto.listener';
import { AuditModule } from '../audit/audit.module';
import { PluginsModule } from '../plugins/plugins.module';

/**
 * Owns the `reports` queue as well as the synchronous export API.
 *
 * The processor lives here rather than in a separate worker module so a single
 * `docker compose up` processes report jobs: the API container registers the
 * worker alongside the queue, exactly as the scanner already does.
 */
@Module({
  imports: [BullModule.registerQueue({ name: REPORTS_QUEUE }), AuditModule, PluginsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportGeneratorService,
    ReportStorageService,
    AutoReportService,
    ReportsProcessor,
    ReportsAutoListener,
  ],
  exports: [ReportsService, ReportGeneratorService, ReportStorageService, AutoReportService],
})
export class ReportsModule {}
