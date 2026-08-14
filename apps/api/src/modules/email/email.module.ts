import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailListener } from './email.listener';
import { EMAIL_QUEUE } from './email.jobs';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Outbound transactional email.
 *
 * Imports ReportsModule to read the already-generated PDF, and
 * NotificationsModule for the per-user email preferences. It is imported by
 * nobody: everything it does is triggered by events, so no service anywhere
 * calls into email directly — which is what keeps Resend out of the scan,
 * report and issue services.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    ReportsModule,
    NotificationsModule,
  ],
  providers: [EmailService, EmailProcessor, EmailListener],
  exports: [EmailService],
})
export class EmailModule {}
