import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditEventsListener } from './audit-events.listener';
import { LogStreamService } from './log-stream.service';
import { LogRetentionService, RETENTION_QUEUE } from './log-retention.service';
import { LogRetentionProcessor } from './log-retention.processor';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Logging, the log explorer API, and retention.
 *
 * The retention queue is registered here rather than reusing the `scanner`
 * queue: a cleanup pass and a security scan have unrelated concurrency,
 * retry and priority needs, and sharing a queue would let a long scan backlog
 * delay the cleanup that keeps the table from growing without bound.
 *
 * SettingsModule is not imported — it is global.
 */
@Module({
  imports: [BullModule.registerQueue({ name: RETENTION_QUEUE }), NotificationsModule],
  providers: [
    AuditService,
    LogStreamService,
    LogRetentionService,
    LogRetentionProcessor,
    AuditEventsListener,
  ],
  controllers: [AuditController],
  exports: [AuditService, LogStreamService, LogRetentionService],
})
export class AuditModule {}
