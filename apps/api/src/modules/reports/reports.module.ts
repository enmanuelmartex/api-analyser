import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportStorageService } from './report-storage.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportGeneratorService, ReportStorageService],
  exports: [ReportsService, ReportGeneratorService, ReportStorageService],
})
export class ReportsModule {}
