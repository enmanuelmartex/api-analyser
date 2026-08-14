import { beforeEach, describe, expect, it } from 'bun:test';
import type { AuditLog, LiveLogEvent } from '@/types';
import {
  DEFAULT_WINDOW_MINUTES,
  MAX_BUFFERED_EVENTS,
  clearEvents,
  getEvents,
  mergeEvents,
  setWindowMinutes,
  toLiveEvent,
} from './live-events-store';

/**
 * The rules that make the recent-event buffer safe to feed from two sources.
 *
 * The backfill and the live stream overlap by construction — an event written
 * between the query and the subscription arrives down both — so de-duplication
 * and ordering are not defensive extras here, they are the reason one merge
 * path exists instead of two.
 */

const event = (id: string, createdAt: string, over: Partial<LiveLogEvent> = {}): LiveLogEvent => ({
  id,
  createdAt,
  event: 'scan.started',
  severity: 'INFO',
  category: 'SCANS',
  status: 'SUCCESS',
  message: null,
  resource: 'assessment',
  source: 'api',
  userId: null,
  userName: null,
  requestId: null,
  ...over,
});

const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

beforeEach(() => {
  clearEvents();
  setWindowMinutes(DEFAULT_WINDOW_MINUTES);
});

describe('mergeEvents', () => {
  it('keeps events in timestamp order regardless of arrival order', () => {
    mergeEvents([event('c', at(10))]);
    mergeEvents([event('a', at(30)), event('b', at(20))]);

    expect(getEvents().map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an event it already holds', () => {
    const first = event('a', at(10));
    mergeEvents([first]);
    mergeEvents([first]);

    expect(getEvents()).toHaveLength(1);
  });

  it('de-duplicates the overlap between a backfill and the stream', () => {
    // The backfill returns three rows; the stream then replays the newest of
    // them plus one that is genuinely new.
    mergeEvents([event('a', at(30)), event('b', at(20)), event('c', at(10))]);
    mergeEvents([event('c', at(10)), event('d', at(5))]);

    expect(getEvents().map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns a stable reference when nothing changed', () => {
    mergeEvents([event('a', at(10))]);
    const before = getEvents();
    mergeEvents([event('a', at(10))]);

    // useSyncExternalStore re-renders on identity, so an unchanged buffer that
    // returned a fresh array would render forever.
    expect(getEvents()).toBe(before);
  });

  it('breaks timestamp ties on id so the order does not shuffle', () => {
    const same = at(10);
    mergeEvents([event('b', same), event('a', same)]);
    const first = getEvents().map((entry) => entry.id);
    mergeEvents([event('c', same)]);

    expect(first).toEqual(['a', 'b']);
    expect(getEvents().map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('retention', () => {
  it('drops events older than the window', () => {
    setWindowMinutes(1);
    mergeEvents([event('old', at(120)), event('recent', at(5))]);

    expect(getEvents().map((entry) => entry.id)).toEqual(['recent']);
  });

  it('prunes what a narrowed window now excludes', () => {
    setWindowMinutes(60);
    mergeEvents([event('old', at(30 * 60)), event('recent', at(5))]);
    expect(getEvents()).toHaveLength(2);

    setWindowMinutes(15);
    expect(getEvents().map((entry) => entry.id)).toEqual(['recent']);
  });

  it('caps the buffer at the ceiling, keeping the newest', () => {
    const many = Array.from({ length: MAX_BUFFERED_EVENTS + 25 }, (_, index) =>
      // Oldest first: index 0 is the furthest in the past.
      event(`e${String(index).padStart(4, '0')}`, at(MAX_BUFFERED_EVENTS + 25 - index)),
    );
    mergeEvents(many);

    const kept = getEvents();
    expect(kept).toHaveLength(MAX_BUFFERED_EVENTS);
    expect(kept[kept.length - 1].id).toBe(`e${String(MAX_BUFFERED_EVENTS + 24).padStart(4, '0')}`);
    expect(kept[0].id).toBe('e0025');
  });
});

describe('toLiveEvent', () => {
  it('flattens a history row into the shape the stream pushes', () => {
    const row = {
      id: 'log_1',
      createdAt: at(5),
      event: 'report.generated',
      severity: 'INFO',
      category: 'REPORTS',
      status: 'SUCCESS',
      resource: 'report',
      message: 'TECHNICAL report generated as PDF',
      source: 'api',
      userId: 'user_1',
      user: { id: 'user_1', name: 'Administrator', email: 'admin@example.test' },
      requestId: 'req_1',
    } as AuditLog;

    expect(toLiveEvent(row)).toEqual({
      id: 'log_1',
      createdAt: row.createdAt,
      event: 'report.generated',
      severity: 'INFO',
      category: 'REPORTS',
      status: 'SUCCESS',
      message: 'TECHNICAL report generated as PDF',
      resource: 'report',
      source: 'api',
      userId: 'user_1',
      userName: 'Administrator',
      requestId: 'req_1',
    });
  });

  it('reads as a system event when no user is attached', () => {
    const row = {
      id: 'log_2',
      createdAt: at(5),
      event: 'scan.started',
      severity: 'INFO',
      category: 'SCANS',
      status: 'SUCCESS',
      resource: 'assessment',
    } as AuditLog;

    expect(toLiveEvent(row).userName).toBeNull();
    expect(toLiveEvent(row).message).toBeNull();
  });
});
