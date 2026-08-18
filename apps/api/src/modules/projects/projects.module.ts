import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';
import { REPORTS_QUEUE } from '../reports/auto-report.service';

/**
 * Registers the `scanner` and `reports` queues so a hard project delete can
 * cancel in-flight jobs it is about to orphan. Registering the same named
 * queue from a second module is the pattern already used by
 * `AssessmentsModule`/`ScannerModule` — Nest resolves it to the one BullMQ
 * connection, not a second queue.
 */
@Module({
  imports: [
    AuditModule,
    ReportsModule,
    BullModule.registerQueue({ name: 'scanner' }, { name: REPORTS_QUEUE }),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
