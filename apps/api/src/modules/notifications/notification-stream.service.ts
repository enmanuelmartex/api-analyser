import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { Notification } from '@prisma/client';

interface Envelope {
  userId: string;
  notification: Notification;
}

/**
 * Per-user delivery of newly created notifications.
 *
 * One process-wide subject with a userId filter on the read side, exactly like
 * LogStreamService — a map of per-user subjects would need reference counting
 * and cleanup on the last unsubscribe, which is a leak waiting to happen for no
 * gain at this scale.
 *
 * The filter is applied inside `subscribe`, so a user can never be handed
 * another user's notification even though the subject carries everyone's.
 */
@Injectable()
export class NotificationStreamService {
  private readonly logger = new Logger(NotificationStreamService.name);
  private readonly subject = new Subject<Envelope>();

  publish(userId: string, notification: Notification) {
    try {
      this.subject.next({ userId, notification });
    } catch (err) {
      this.logger.warn(`Failed to publish notification: ${(err as Error).message}`);
    }
  }

  subscribe(userId: string): Observable<MessageEvent> {
    return this.subject.pipe(
      filter((envelope) => envelope.userId === userId),
      map((envelope) => ({ data: envelope.notification }) as MessageEvent),
    );
  }
}
