import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsRetentionPort } from '../audit/notifications-retention.port';

/**
 * Depends on nothing but Prisma and the global SettingsModule.
 *
 * In particular it does not import AuditModule: notifications are produced by
 * reacting to events on the bus, never by a module calling into them. That is
 * what lets AuditModule depend on this one — for the retention port below —
 * without a cycle or a `forwardRef`.
 */
@Module({
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationStreamService,
    NotificationsListener,
    // NotificationsService implements the port; `useExisting` binds the token to
    // the same instance rather than constructing a second one.
    { provide: NotificationsRetentionPort, useExisting: NotificationsService },
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationPreferencesService, NotificationsRetentionPort],
})
export class NotificationsModule {}
