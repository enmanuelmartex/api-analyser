'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconCopy,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconAlertTriangle,
} from '@tabler/icons-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { logsApi } from '@/lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LogCategoryBadge, LogSeverityBadge, LogStatusBadge, humaniseEvent } from '../_components/log-badges';

/**
 * The full record of one event.
 *
 * A Sheet rather than a dialog: an investigator reads a detail, goes back to
 * the list, opens the next one. A side panel keeps the table visible and its
 * scroll position intact, which a centred modal does not.
 *
 * The list response is deliberately a narrower projection than this — metadata
 * and stack traces can be kilobytes each — so opening a row fetches the
 * complete record rather than rendering a partial one.
 */
export function LogDetailSheet({
  logId,
  open,
  onOpenChange,
}: {
  logId: string | null;
  open: boolean;
  // eslint-disable-next-line no-unused-vars
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit-log', logId],
    queryFn: () => logsApi.get(logId!),
    enabled: Boolean(logId) && open,
    staleTime: Infinity, // A recorded event is immutable.
  });

  const hasError = Boolean(data?.errorCode || data?.stackTrace || data?.status === 'FAILED');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        A three-part column, not one scrolling block.

        Previously the whole panel scrolled together and only the header carried
        padding, so the body ran edge to edge — which is why values appeared cut
        off at the right — and the title scrolled away exactly when a long
        stack trace made it most useful to still see what event was being read.

        The width ladder stops at 42rem: wide enough that a route or a token id
        fits on one line on a laptop, narrow enough that the table it was opened
        from stays visible behind it. Below `sm` it is full width, because a
        three-quarter-width panel on a phone is unreadable in both directions.
      */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg lg:max-w-2xl"
      >
        {isLoading && (
          <div className="overflow-y-auto p-5">
            <DetailSkeleton />
          </div>
        )}

        {isError && (
          <div className="p-5 pt-12">
            <Alert variant="destructive">
              <IconAlertTriangle />
              <AlertDescription>
                {(error as any)?.response?.data?.message ?? 'Could not load this event.'}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {data && (
          <>
            {/* `pr-12` clears the absolutely positioned close button. */}
            <SheetHeader className="shrink-0 space-y-2.5 border-b border-border p-5 pr-12 text-left">
              <div className="flex flex-wrap items-center gap-1.5">
                <LogSeverityBadge severity={data.severity} />
                <LogStatusBadge status={data.status} />
                <LogCategoryBadge category={data.category} />
              </div>
              {/*
                `break-words` because the title is the recorded message, and a
                message can be a provider error ending in an unbroken URL —
                whose min-content width would otherwise set the panel's.
              */}
              <SheetTitle className="break-words text-base leading-snug">
                {data.message || humaniseEvent(data.event)}
              </SheetTitle>
              <p className="break-all font-mono text-xs text-muted-foreground">{data.event}</p>
            </SheetHeader>

            {/* `min-h-0` is what lets this flex child actually scroll. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-5">
                <DetailGroup title="Event">
                  <DetailRow label="Timestamp" value={formatFull(data.createdAt)} />
                  <DetailRow label="Action" value={data.event} mono />
                  <DetailRow label="Severity" value={data.severity} />
                  <DetailRow label="Category" value={data.category} />
                  <DetailRow label="Status" value={data.status} />
                  <DetailRow label="Resource" value={data.resource} mono />
                  <DetailRow label="Resource ID" value={data.resourceId} mono copyable />
                  <DetailRow label="Source" value={data.source} mono />
                  <DetailRow label="Event ID" value={data.id} mono copyable />
                </DetailGroup>

                <DetailGroup title="Actor">
                  {data.user ? (
                    <>
                      <DetailRow label="User" value={data.user.name} />
                      <DetailRow label="Email" value={data.user.email} />
                      <DetailRow label="Role" value={data.user.role} />
                      <DetailRow label="User ID" value={data.user.id} mono copyable />
                    </>
                  ) : (
                    <DetailRow
                      label="User"
                      value="System"
                      hint="No signed-in user was attached to this event."
                    />
                  )}
                  <DetailRow label="IP address" value={data.ipAddress} mono copyable />
                  <DetailRow label="User agent" value={data.userAgent} />
                </DetailGroup>

                {(data.httpMethod ||
                  data.route ||
                  data.requestId ||
                  data.statusCode !== null ||
                  (data.durationMs !== null && data.durationMs !== undefined)) && (
                  <DetailGroup title="Request">
                    <DetailRow label="Method" value={data.httpMethod} mono />
                    <DetailRow label="Endpoint" value={data.route} mono />
                    <DetailRow
                      label="Response code"
                      value={
                        data.statusCode !== null && data.statusCode !== undefined
                          ? String(data.statusCode)
                          : null
                      }
                      mono
                    />
                    <DetailRow label="Request ID" value={data.requestId} mono copyable />
                    <DetailRow
                      label="Duration"
                      value={
                        data.durationMs !== null && data.durationMs !== undefined
                          ? `${data.durationMs} ms`
                          : null
                      }
                    />
                  </DetailGroup>
                )}

                {(data.projectId || data.assessmentId || data.reportId) && (
                  <DetailGroup title="Related">
                    {data.projectId && (
                      <LinkedRow
                        label="Project"
                        id={data.projectId}
                        href={`/projects/${data.projectId}`}
                      />
                    )}
                    {data.assessmentId && (
                      <LinkedRow
                        label="Scan"
                        id={data.assessmentId}
                        href={`/assessments/${data.assessmentId}`}
                      />
                    )}
                    {data.reportId && (
                      <DetailRow label="Report" value={data.reportId} mono copyable />
                    )}
                  </DetailGroup>
                )}

                {/*
                  Failures are set apart rather than recoloured.

                  A tinted panel is enough to find at a glance while scrolling,
                  without turning the sheet into a red screen — severity is
                  already stated in the header badges, and repeating it loudly
                  here would just compete with the text being read.
                */}
                {hasError && (
                  <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <GroupHeading title="Error" className="text-destructive/80" />
                    <dl className="divide-y divide-destructive/10">
                      <DetailRow label="Code" value={data.errorCode} mono copyable />
                      <DetailRow
                        label="Outcome"
                        value={data.status === 'FAILED' ? 'The operation did not complete' : null}
                      />
                    </dl>
                    {data.stackTrace && (
                      <DisclosureSection title="Stack trace">
                        <CodeBlock text={data.stackTrace} className="max-h-80" />
                      </DisclosureSection>
                    )}
                  </section>
                )}

                {data.metadata && Object.keys(data.metadata).length > 0 && (
                  <div className="space-y-2">
                    <GroupHeading title="Metadata" />
                    <JsonViewer value={data.metadata} />
                  </div>
                )}

                <Separator />

                {/*
                  The whole record, verbatim.

                  Collapsed by default: the sections above are the readable view,
                  and this exists for the case where the field an investigator
                  needs is one the layout above does not surface — or where it has
                  to be pasted into a ticket exactly as stored.
                */}
                <DisclosureSection title="Raw data">
                  <JsonViewer value={data} className="max-h-96" />
                </DisclosureSection>
              </div>
            </div>

            {/* Pinned: the action stays reachable without scrolling to the end
                of a kilobyte-long metadata blob to find it. */}
            <div className="shrink-0 border-t border-border p-4">
              <CopyJsonButton payload={data} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A collapsed block with a small-caps heading and a rotating chevron. */
function DisclosureSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function GroupHeading({ title, className }: { title: string; className?: string }) {
  return (
    <p
      className={cn(
        'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      {title}
    </p>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <GroupHeading title={title} />
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

/**
 * One label/value pair, and the reason nothing is cut off any more.
 *
 * The previous row was a `justify-between` flex whose value was `truncate`d and
 * right-aligned. Every value that did not fit — which is most of them: ids,
 * routes, user agents, emails on a narrow panel — was silently clipped mid-word
 * with no way to read the rest.
 *
 * Now it is a two-column grid whose value column is left-aligned, `min-w-0` and
 * allowed to wrap onto as many lines as it needs. Below `sm` the label sits on
 * its own line above the value, which buys the value the full panel width.
 *
 * `break-all` for monospace values only: identifiers, hashes and routes have no
 * spaces to break at, so `break-words` alone would leave them overflowing.
 * Prose — a name, a message, a user agent — breaks between words instead, which
 * stays readable.
 *
 * Renders nothing when the value is absent. A log record is mostly nulls by
 * design — an HTTP event has no stack trace, a worker event has no route — and
 * printing "Duration: —" twelve times buries the six fields that are populated.
 */
function DetailRow({
  label,
  value,
  mono,
  copyable,
  hint,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  copyable?: boolean;
  hint?: string;
}) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-xs text-muted-foreground sm:pt-px">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1.5">
        <span
          className={cn(
            'min-w-0 flex-1 text-xs text-foreground',
            mono ? 'break-all font-mono' : 'break-words',
          )}
        >
          {value}
        </span>
        {copyable && <CopyButton value={value} label={label} />}
        {hint && <span className="sr-only">{hint}</span>}
      </dd>
    </div>
  );
}

function LinkedRow({ label, id, href }: { label: string; id: string; href: string }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-xs text-muted-foreground sm:pt-px">{label}</dt>
      <dd className="min-w-0">
        <Link
          href={href}
          className="inline-flex min-w-0 items-baseline gap-1 font-mono text-xs text-primary hover:underline"
        >
          <span className="break-all">{id}</span>
          <IconExternalLink className="h-3 w-3 shrink-0 self-center" />
        </Link>
      </dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex-shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
    >
      {copied ? <IconCheck className="h-3 w-3 text-success" /> : <IconCopy className="h-3 w-3" />}
    </button>
  );
}

/**
 * Structured JSON view.
 *
 * Pretty-printed rather than syntax-highlighted: a highlighter is another
 * dependency and a second colour vocabulary, and what an operator needs here is
 * to read the values and copy them, both of which plain indented JSON does.
 */
function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '// This payload could not be serialised for display.';
    }
  }, [value]);

  return <CodeBlock text={text} className={className} />;
}

/**
 * A scrollable monospace block.
 *
 * Scrolls in both axes inside its own border rather than wrapping: indentation
 * is what makes nested JSON readable, and soft-wrapping a stack trace turns one
 * frame into three lines that look like three frames. The container is the only
 * thing that scrolls sideways — the panel itself never does.
 */
function CodeBlock({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground',
        className,
      )}
    >
      {text}
    </pre>
  );
}

function CopyJsonButton({ payload }: { payload: unknown }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          toast.success('Event copied as JSON');
        } catch {
          // Clipboard access is denied in insecure contexts and some embedded
          // browsers. Saying so beats a button that silently does nothing.
          toast.error('Could not access the clipboard');
        }
      }}
    >
      {copied ? <IconCheck className="h-4 w-4 text-success" /> : <IconCopy className="h-4 w-4" />}
      {copied ? 'Copied' : 'Copy JSON'}
    </Button>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 pt-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-6 w-3/4" />
      </div>
      {Array.from({ length: 3 }).map((_, group) => (
        <div key={group} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 4 }).map((_, row) => (
            <Skeleton key={row} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** e.g. "Aug 13, 2026 · 12:44:08.291" — seconds matter when correlating events. */
function formatFull(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} · ${date.toLocaleTimeString(undefined, { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
