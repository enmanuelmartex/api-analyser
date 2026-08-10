import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';
import { AuditModule } from '../audit/audit.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [AuditModule, PluginsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportGeneratorService, ReportStorageService],
  exports: [ReportsService, ReportGeneratorService, ReportStorageService],
})
export class ReportsModule {}
