import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { LogCategory, LogSeverity } from '@prisma/client';

/** A persisted event, as pushed to live subscribers. */
export interface StreamedLog {
  id: string;
  createdAt: Date;
  event: string;
  severity: LogSeverity;
  category: LogCategory;
  status: string;
  message: string | null;
  resource: string;
  source: string | null;
  userId: string | null;
  userName: string | null;
  requestId: string | null;
}

export interface StreamFilter {
  severities?: LogSeverity[];
  categories?: LogCategory[];
}

/**
 * Fan-out of newly written events to live subscribers.
 *
 * A single process-wide `Subject` rather than one per subscriber: the producer
 * side must stay cheap, because it runs inside every audit write. Filtering
 * happens per subscription on the read side, so a viewer watching only ERROR
 * costs the writer nothing.
 *
 * Deliberately in-memory and lossy. This is a live tail, not a delivery
 * guarantee — the durable copy is the row in `audit_logs`, and the history view
 * reads that. If the API is scaled to several instances a subscriber sees only
 * its own instance's events; making that complete needs Redis pub/sub, which is
 * noted in the settings screen rather than silently assumed away.
 */
@Injectable()
export class LogStreamService {
  private readonly logger = new Logger(LogStreamService.name);
  private readonly subject = new Subject<StreamedLog>();

  /** Live subscriber count, surfaced in Log Management. */
  private subscribers = 0;

  publish(log: StreamedLog) {
    // Never let a broken subscriber break the write path that called us.
    try {
      this.subject.next(log);
    } catch (err) {
      this.logger.warn(`Failed to publish log to live stream: ${(err as Error).message}`);
    }
  }

  get subscriberCount(): number {
    return this.subscribers;
  }

  /**
   * An SSE-shaped stream of matching events.
   *
   * The filter is applied here so an idle viewer of one category does not have
   * every unrelated event serialised and pushed down its connection.
   */
  subscribe(criteria: StreamFilter = {}): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      this.subscribers += 1;

      const subscription = this.subject
        .pipe(
          filter((log) => {
            if (criteria.severities?.length && !criteria.severities.includes(log.severity)) {
              return false;
            }
            if (criteria.categories?.length && !criteria.categories.includes(log.category)) {
              return false;
            }
            return true;
          }),
          map((log) => ({ data: log }) as MessageEvent),
        )
        .subscribe(observer);

      return () => {
        subscription.unsubscribe();
        this.subscribers = Math.max(0, this.subscribers - 1);
      };
    });
  }
}
