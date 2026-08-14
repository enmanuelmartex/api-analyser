import type { AuditLog, LiveLogEvent } from '@/types';

/**
 * The recent-event buffer behind the Live Events viewer.
 *
 * Deliberately a module-scoped store rather than component state. The viewer
 * used to hold its events in `useState`, which made "live" mean "arrived while
 * this tab was mounted": opening the screen after doing something showed an
 * empty console, and switching to Audit History and back threw the buffer away.
 *
 * There are two layers of durability here and they do different jobs:
 *
 *   • The database — every event is already a row in `audit_logs` before it is
 *     streamed. That is what makes recent history recoverable at all, and the
 *     viewer seeds itself from it on mount (see `toLiveEvent`).
 *   • This store — keeps the merged view alive across mounts inside one browser
 *     session, so navigating away and back does not re-flash an empty console
 *     while the backfill request is in flight.
 *
 * Nothing here is a delivery guarantee, and it must not become one: the durable
 * copy is the row, and Audit History is the complete view of it.
 */

/** Newest events kept in memory. Older entries fall off the front. */
export const MAX_BUFFERED_EVENTS = 500;

/** Recent-window presets, in minutes. `windowMinutes` picks one. */
export const RETENTION_WINDOWS = [
  { minutes: 15, label: 'Last 15 minutes' },
  { minutes: 60, label: 'Last hour' },
  { minutes: 6 * 60, label: 'Last 6 hours' },
  { minutes: 24 * 60, label: 'Last 24 hours' },
] as const;

export const DEFAULT_WINDOW_MINUTES = 60;

/** How many rows the backfill asks the server for. Bounded by the API at 200. */
export const BACKFILL_LIMIT = 200;

type Listener = () => void;

let events: LiveLogEvent[] = [];
let windowMs = DEFAULT_WINDOW_MINUTES * 60_000;
const listeners = new Set<Listener>();

/**
 * The current buffer.
 *
 * Returns the same array reference until something actually changes, which is
 * what `useSyncExternalStore` requires — a fresh array on every read is an
 * infinite render loop.
 */
export function getEvents(): LiveLogEvent[] {
  return events;
}

/** Server-rendered snapshot: there is no buffer before hydration. */
export function getServerEvents(): LiveLogEvent[] {
  return EMPTY;
}

const EMPTY: LiveLogEvent[] = [];

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/** Sets the retention window and immediately drops anything now outside it. */
export function setWindowMinutes(minutes: number) {
  const next = minutes * 60_000;
  if (next === windowMs) return;
  windowMs = next;
  const pruned = prune(events);
  if (pruned !== events) {
    events = pruned;
    emit();
  }
}

/**
 * Merges events into the buffer.
 *
 * One path for both the backfill and the live stream so the de-duplication and
 * ordering rules cannot differ between them — the two overlap by construction,
 * since an event can be written between the backfill query and the stream
 * subscription that follows it.
 */
export function mergeEvents(incoming: LiveLogEvent[]): void {
  if (incoming.length === 0) return;

  const byId = new Map(events.map((event) => [event.id, event]));
  let changed = false;

  for (const event of incoming) {
    if (byId.has(event.id)) continue;
    byId.set(event.id, event);
    changed = true;
  }

  if (!changed) return;

  // Oldest first, matching how a console reads. `id` breaks ties so two events
  // written in the same millisecond keep a stable order between renders rather
  // than swapping places on the next merge.
  const merged = [...byId.values()].sort((a, b) => {
    const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  events = prune(merged);
  emit();
}

/** Clears the view. Never touches what is stored on the server. */
export function clearEvents(): void {
  if (events.length === 0) return;
  events = EMPTY;
  emit();
}

/**
 * Applies both retention rules: the time window first, then the hard ceiling.
 *
 * Returns the original array when nothing was dropped, so an unchanged buffer
 * does not invalidate the snapshot identity.
 */
function prune(candidate: LiveLogEvent[]): LiveLogEvent[] {
  const cutoff = Date.now() - windowMs;
  const withinWindow =
    candidate.length && Date.parse(candidate[0].createdAt) < cutoff
      ? candidate.filter((event) => Date.parse(event.createdAt) >= cutoff)
      : candidate;

  if (withinWindow.length <= MAX_BUFFERED_EVENTS) return withinWindow;
  return withinWindow.slice(withinWindow.length - MAX_BUFFERED_EVENTS);
}

/**
 * Narrows a history row to the shape the stream pushes.
 *
 * The list endpoint returns a wider projection than the SSE frame — a nested
 * `user` object rather than a flat `userName` — so backfilled and live events
 * are made identical here instead of teaching the viewer to render two shapes.
 */
export function toLiveEvent(row: AuditLog): LiveLogEvent {
  return {
    id: row.id,
    createdAt: row.createdAt,
    event: row.event,
    severity: row.severity,
    category: row.category,
    status: row.status,
    message: row.message ?? null,
    resource: row.resource,
    source: row.source ?? null,
    userId: row.userId ?? null,
    userName: row.user?.name ?? null,
    requestId: row.requestId ?? null,
  };
}
