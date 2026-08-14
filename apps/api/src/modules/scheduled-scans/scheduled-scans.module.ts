import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { PluginsModule } from '../plugins/plugins.module';
import { ScheduledScansController } from './scheduled-scans.controller';
import { ScheduledScansService } from './scheduled-scans.service';
import { ScheduleDispatcherService } from './schedule-dispatcher.service';
import { ScheduleExecutionListener } from './schedule-execution.listener';
import { SchedulerService, SCHEDULER_QUEUE } from './scheduler.service';

/**
 * Scheduled scans.
 *
 * Two things this module deliberately does NOT do:
 *
 *  - It does not import ScannerModule. Scheduling never touches the scan
 *    engine; it calls `AssessmentsService.createAndRun`, the same entry point
 *    the "Run Assessment" button uses, and the existing `scanner` queue takes
 *    it from there. There is one scan pipeline.
 *
 *  - It does not import AuditModule or NotificationsModule. Everything it needs
 *    to announce goes out on the event bus, where the audit writer and the
 *    notification dispatcher pick it up independently — the same arrangement
 *    the scanner uses, and what keeps this module unaware that either exists.
 *
 * The `scheduled-scans` queue is still registered, but nothing is produced onto
 * it: the heartbeat is an in-process interval (see SchedulerService for why the
 * BullMQ repeatable job had to go). The registration remains so a legacy
 * repeat config left by that design can be removed from Redis at boot.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
    PrismaModule,
    AssessmentsModule,
    PluginsModule,
  ],
  controllers: [ScheduledScansController],
  providers: [
    ScheduledScansService,
    ScheduleDispatcherService,
    SchedulerService,
    ScheduleExecutionListener,
  ],
  exports: [ScheduledScansService, SchedulerService],
})
export class ScheduledScansModule {}
