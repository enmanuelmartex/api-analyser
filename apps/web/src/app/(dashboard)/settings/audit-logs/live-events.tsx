'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconArrowDown,
  IconSearch,
  IconX,
  IconPlugConnected,
  IconPlugConnectedX,
  IconLoader2,
} from '@tabler/icons-react';
import { cn, formatTimeOfDay } from '@/lib/utils';
import { logsApi } from '@/lib/api';
import type { LiveLogEvent, LogCategory, LogSeverity } from '@/types';
import { LOG_CATEGORIES, LOG_SEVERITIES } from '@/types';
import {
  BACKFILL_LIMIT,
  DEFAULT_WINDOW_MINUTES,
  MAX_BUFFERED_EVENTS,
  RETENTION_WINDOWS,
  clearEvents,
  getEvents,
  getServerEvents,
  mergeEvents,
  setWindowMinutes,
  subscribe as subscribeToBuffer,
  toLiveEvent,
} from '@/lib/live-events-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityRail, humaniseEvent } from '../_components/log-badges';

type ConnectionState = 'connecting' | 'open' | 'error' | 'paused' | 'disabled';

/** What the current state means, in one line, beside the status pill. */
const DESCRIPTIONS: Record<ConnectionState, string> = {
  connecting: 'Loading recent events…',
  open: 'Recent activity, updating in real time.',
  paused: 'View frozen. Events are still being recorded and will appear on resume.',
  error: 'Connection lost. Reconnecting automatically.',
  disabled: 'Streaming is switched off. Showing recent recorded events.',
};

/**
 * The recent-activity viewer.
 *
 * Two sources, one buffer:
 *
 *   1. A backfill query over the recorded events inside the retention window,
 *      issued on mount and whenever the window or the server-side filters
 *      change. This is what makes the screen useful to someone who opens it
 *      *after* the thing they want to look at happened — previously it showed
 *      only what arrived while the tab was mounted, so arriving five minutes
 *      late meant an empty console.
 *   2. The SSE stream, for everything from that point on.
 *
 * Both go through the same store, which de-duplicates by id, keeps the merged
 * list in timestamp order and enforces the retention rules. The overlap between
 * the two is real, not theoretical: an event written between the backfill query
 * and the subscription that follows it arrives down both paths.
 *
 * The SSE mechanism is the one the assessment progress stream already uses
 * rather than WebSockets: the traffic is one-directional, EventSource
 * reconnects on its own, and a second transport would mean a second auth path.
 *
 * The two "pause" concepts in this screen are deliberately distinct and never
 * share a control:
 *
 *   • Pause (here)      — stops updating the view. Events keep being recorded,
 *                         and arrivals are held so resuming shows them all.
 *   • Log collection    — in Log Management. Stops events being *recorded*.
 *
 * Conflating them is how an operator ends up with a gap in their audit trail
 * they meant to be a pause in a viewport.
 */
export function LiveEvents({
  streamEnabled,
  onOpenEvent,
}: {
  streamEnabled: boolean;
  // eslint-disable-next-line no-unused-vars
  onOpenEvent: (id: string) => void;
}) {
  const events = React.useSyncExternalStore(subscribeToBuffer, getEvents, getServerEvents);

  const [paused, setPaused] = React.useState(false);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [connection, setConnection] = React.useState<ConnectionState>('connecting');
  const [search, setSearch] = React.useState('');
  const [severity, setSeverity] = React.useState<LogSeverity[]>([]);
  const [category, setCategory] = React.useState<LogCategory[]>([]);
  const [windowMinutes, setWindow] = React.useState(DEFAULT_WINDOW_MINUTES);
  const [rate, setRate] = React.useState(0);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Held in refs as well as state: the SSE handler is created once per
  // connection and would otherwise close over the initial values forever.
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;
  /** Arrivals received while paused, merged in full on resume. */
  const heldRef = React.useRef<LiveLogEvent[]>([]);

  // Counted in a ref rather than state so arrival does not re-render; the
  // displayed figure updates once a second from the interval below.
  const arrivalsRef = React.useRef(0);

  // Serialised so the effects below depend on the *contents* of the filters
  // rather than on array identity, which changes on every render.
  const severityKey = severity.join(',');
  const categoryKey = category.join(',');

  React.useEffect(() => {
    setWindowMinutes(windowMinutes);
  }, [windowMinutes]);

  /*
   * A change to the server-side filters makes the buffer wrong, not stale: it
   * holds events the new filter excludes, and the backfill that follows cannot
   * remove them. Clearing is the honest response — the recorded events are
   * untouched and the refetch repopulates the view immediately.
   */
  const firstFilterRun = React.useRef(true);
  React.useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    clearEvents();
  }, [severityKey, categoryKey]);

  /*
   * Recent history.
   *
   * `from` is computed inside the query function rather than in the key: putting
   * a `Date.now()`-derived value in the key would make every render a cache miss.
   * Always refetched on mount, because "recent" a minute ago is not recent now.
   */
  const backfill = useQuery({
    queryKey: ['audit-logs', 'recent', severityKey, categoryKey, windowMinutes],
    queryFn: () =>
      logsApi.list({
        severity: severity.length ? severity : undefined,
        category: category.length ? category : undefined,
        from: new Date(Date.now() - windowMinutes * 60_000).toISOString(),
        limit: BACKFILL_LIMIT,
        sortBy: 'createdAt',
        sortDir: 'desc',
      }),
    refetchOnMount: 'always',
    staleTime: 0,
  });

  React.useEffect(() => {
    if (!backfill.data) return;
    mergeEvents(backfill.data.items.map(toLiveEvent));
  }, [backfill.data]);

  /*
   * Connection lifecycle.
   *
   * Depends on the server-side filters only. Search runs client-side over the
   * buffer, so typing must not tear down and re-establish the stream — that
   * would drop every buffered event on each keystroke.
   */
  React.useEffect(() => {
    if (!streamEnabled) {
      setConnection('disabled');
      return;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('api_analyser_token') : null;
    if (!token) {
      setConnection('error');
      return;
    }

    setConnection('connecting');
    const source = logsApi.stream(token, { severity, category });

    source.onopen = () => setConnection('open');

    source.onmessage = (message) => {
      arrivalsRef.current += 1;

      try {
        const event = JSON.parse(message.data) as LiveLogEvent;
        // Held rather than dropped: an operator who pauses to read a line does
        // not mean "discard everything that happens meanwhile", and the events
        // are cheap to keep until resume merges them in order.
        if (pausedRef.current) heldRef.current.push(event);
        else mergeEvents([event]);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    source.onerror = () => {
      // EventSource reconnects by itself; this only reflects the current state
      // rather than trying to reimplement its backoff.
      setConnection((state) => (state === 'open' ? 'error' : state));
    };

    return () => source.close();
    // The two filter arrays come from `useState`, so their identity changes only
    // when a filter actually changes — the connection is not rebuilt per render.
  }, [streamEnabled, severity, category]);

  /**
   * Resuming flushes what arrived while frozen.
   *
   * A reconnection can have happened during the pause, so the backfill is also
   * refetched — that is what closes any gap the stream itself dropped.
   */
  function togglePause() {
    setPaused((current) => {
      if (current) {
        if (heldRef.current.length) {
          mergeEvents(heldRef.current);
          heldRef.current = [];
        }
        void backfill.refetch();
      }
      return !current;
    });
  }

  // Events-per-second, sampled once a second.
  React.useEffect(() => {
    const timer = setInterval(() => {
      setRate(arrivalsRef.current);
      arrivalsRef.current = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const visible = React.useMemo(() => {
    if (!search.trim()) return events;
    const term = search.toLowerCase();
    return events.filter((event) =>
      [event.message, event.event, event.resource, event.source, event.userName, event.requestId]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [events, search]);

  // Follow the tail. Guarded on `autoScroll` so an operator reading back
  // through the buffer is not yanked to the bottom by the next arrival.
  React.useEffect(() => {
    if (!autoScroll || paused) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, autoScroll, paused]);

  const effectiveState: ConnectionState = paused ? 'paused' : connection;
  const windowLabel =
    RETENTION_WINDOWS.find((option) => option.minutes === windowMinutes)?.label ?? 'Recent';

  return (
    <div className="space-y-3">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-semibold text-foreground">Live events</h3>
          <ConnectionPill state={effectiveState} rate={rate} />
        </div>
        <p className="text-xs text-muted-foreground">{DESCRIPTIONS[effectiveState]}</p>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative min-w-[180px] flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter the buffer…"
            className="h-8 pl-8 pr-8 text-xs"
            aria-label="Filter live events"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/*
          The retention window, and the only control that changes what the
          backfill asks for. Kept next to the filters because that is what it is
          — a filter over time — rather than a viewer setting.
        */}
        <Select
          value={String(windowMinutes)}
          onValueChange={(value) => setWindow(Number(value))}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Recent window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_WINDOWS.map((option) => (
              <SelectItem key={option.minutes} value={String(option.minutes)} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <StreamFilterPopover
          severity={severity}
          category={category}
          onSeverityChange={setSeverity}
          onCategoryChange={setCategory}
        />

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={togglePause}
          disabled={!streamEnabled}
        >
          {paused ? (
            <>
              <IconPlayerPlay className="h-3.5 w-3.5" />
              Resume
            </>
          ) : (
            <>
              <IconPlayerPause className="h-3.5 w-3.5" />
              Pause
            </>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={clearEvents}
          disabled={events.length === 0}
          // Says plainly what it does not do — the single most likely
          // misreading of a "Clear" button in a log tool.
          title="Clears this view only. Nothing is deleted from the database."
        >
          <IconTrash className="h-3.5 w-3.5" />
          Clear view
        </Button>

        <div className="flex items-center gap-2 pl-1">
          <Switch
            id="auto-scroll"
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
            aria-label="Follow latest event"
          />
          <Label htmlFor="auto-scroll" className="cursor-pointer whitespace-nowrap text-xs font-normal text-muted-foreground">
            Follow
          </Label>
        </div>
      </div>

      {paused && (
        <Alert variant="warning">
          <IconPlayerPause />
          <AlertDescription>
            Live view is paused. Events are still being recorded and held — resume to see
            everything that arrived since.
          </AlertDescription>
        </Alert>
      )}

      {connection === 'disabled' && (
        <Alert variant="warning">
          <IconPlugConnectedX />
          <AlertDescription>
            Live streaming is switched off in Log Management, so this view shows recent recorded
            events without updating in real time. The full history is under Audit History.
          </AlertDescription>
        </Alert>
      )}

      {connection === 'error' && (
        <Alert variant="destructive">
          <IconPlugConnectedX />
          <AlertDescription>
            Connection lost. Reconnecting automatically — recorded events are unaffected.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Viewer ──────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="h-[480px] overflow-y-auto rounded-xl border border-border bg-card font-mono text-[11px]"
        role="log"
        aria-live="polite"
        aria-label="Live event stream"
      >
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            {backfill.isLoading ? (
              <>
                <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Loading recent events…</p>
              </>
            ) : events.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                No event in this window matches “{search}”.
              </p>
            ) : (
              <>
                <IconPlugConnected className="h-4 w-4 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  Nothing recorded in the {windowLabel.toLowerCase()}
                </p>
                <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground/70">
                  New events appear here as they happen. Widen the window above to look further
                  back, or use Audit History for the complete record.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {visible.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenEvent(event.id)}
                className="flex w-full items-stretch gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <SeverityRail severity={event.severity} />

                {/*
                  Two lines rather than one. A console row that packs time,
                  level, event name, message and actor onto a single line
                  truncates the message — which is the part being read — as soon
                  as the window is anything but full width.

                  The message is nested inside the third column rather than
                  indented by a computed padding, so it aligns under the event
                  name whatever the timestamp renders as.
                */}
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {formatTimeOfDay(event.createdAt, undefined, { seconds: true })}
                </span>
                <span
                  className={cn(
                    'w-16 flex-shrink-0 font-semibold',
                    severityTextClass(event.severity),
                  )}
                >
                  {event.severity}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-foreground">{event.event}</span>
                    <span className="hidden flex-shrink-0 text-muted-foreground/70 sm:inline">
                      {event.userName ?? event.source ?? event.category.toLowerCase()}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-muted-foreground">
                    {event.message || humaniseEvent(event.event)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="min-w-0">
          {visible.length.toLocaleString()} shown
          {search && events.length !== visible.length && ` of ${events.length.toLocaleString()}`}
          {' · '}
          {windowLabel.toLowerCase()}
          {events.length >= MAX_BUFFERED_EVENTS && ` · newest ${MAX_BUFFERED_EVENTS} kept`}
        </span>
        {!autoScroll && visible.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              const node = scrollRef.current;
              if (node) node.scrollTop = node.scrollHeight;
            }}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <IconArrowDown className="h-3 w-3" />
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}

function severityTextClass(severity: LogSeverity): string {
  return {
    DEBUG: 'text-muted-foreground',
    INFO: 'text-cyan',
    WARNING: 'text-severity-medium',
    ERROR: 'text-destructive',
    CRITICAL: 'text-severity-critical',
  }[severity];
}

function ConnectionPill({ state, rate }: { state: ConnectionState; rate: number }) {
  const config: Record<ConnectionState, { label: string; dot: string; variant: any }> = {
    connecting: { label: 'Connecting', dot: 'bg-muted-foreground animate-pulse', variant: 'neutral' },
    open: { label: 'Live', dot: 'bg-success animate-pulse', variant: 'success-light' },
    paused: { label: 'Paused', dot: 'bg-severity-medium', variant: 'neutral' },
    error: { label: 'Reconnecting', dot: 'bg-destructive animate-pulse', variant: 'destructive-light' },
    disabled: { label: 'Disabled', dot: 'bg-muted-foreground/40', variant: 'neutral' },
  };
  const { label, dot, variant } = config[state];

  return (
    <Badge variant={variant} className="h-8 gap-1.5 rounded-md px-2.5 text-xs font-normal">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
      {label}
      {state === 'open' && rate > 0 && (
        <span className="text-muted-foreground">· {rate}/s</span>
      )}
    </Badge>
  );
}

/**
 * Server-side stream filters.
 *
 * Applied on the server rather than in the browser so an idle viewer of one
 * category does not have every unrelated event pushed down its connection.
 * Changing one reconnects the stream, which is why the buffer clears.
 */
function StreamFilterPopover({
  severity,
  category,
  onSeverityChange,
  onCategoryChange,
}: {
  severity: LogSeverity[];
  category: LogCategory[];
  // eslint-disable-next-line no-unused-vars
  onSeverityChange: (next: LogSeverity[]) => void;
  // eslint-disable-next-line no-unused-vars
  onCategoryChange: (next: LogCategory[]) => void;
}) {
  const count = severity.length + category.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          Stream filters
          {count > 0 && (
            <Badge variant="neutral" className="h-4 px-1 text-[10px]">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Severity
        </p>
        <div className="flex flex-wrap gap-1">
          {LOG_SEVERITIES.map((value) => (
            <FilterChip
              key={value}
              label={value}
              active={severity.includes(value)}
              onClick={() =>
                onSeverityChange(
                  severity.includes(value)
                    ? severity.filter((entry) => entry !== value)
                    : [...severity, value],
                )
              }
            />
          ))}
        </div>

        <Separator className="my-3" />

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Category
        </p>
        <div className="flex flex-wrap gap-1">
          {LOG_CATEGORIES.map((value) => (
            <FilterChip
              key={value}
              label={value.toLowerCase()}
              active={category.includes(value)}
              onClick={() =>
                onCategoryChange(
                  category.includes(value)
                    ? category.filter((entry) => entry !== value)
                    : [...category, value],
                )
              }
            />
          ))}
        </div>

        {count > 0 && (
          <>
            <Separator className="my-3" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => {
                onSeverityChange([]);
                onCategoryChange([]);
              }}
            >
              Clear stream filters
            </Button>
          </>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          Changing these reconnects the stream, which clears the buffered view. Recorded events are
          unaffected.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
