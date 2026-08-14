'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconBraces, IconChevronUp, IconSearch } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { MethodBadge } from '@/components/security/method-badge';
import { SeverityBadge } from '@/components/security/severity-badge';
import {
  ALL_TAGS,
  ActiveFilterChips,
  MethodMultiSelect,
  TagSelect,
} from '@/components/projects/endpoint-filters';
import type { Endpoint, SecurityIssue } from '@/types';

/**
 * The attack surface of an API, as a working table.
 *
 * `Endpoint` is a first-class model — 371 rows in this deployment — that had no
 * real surface: the project page listed the first twelve as method-and-path
 * chips and stopped, with no search, no filtering, and no connection to the
 * issues found on them. For an API security tool, "which of my endpoints have
 * problems" is a primary question and it could not be asked.
 *
 * Issues are attached client-side by matching `METHOD + normalizedRoute`
 * against the endpoint's method and path. The scanner deliberately excludes
 * `endpointId` from an issue's fingerprint — re-importing a specification
 * creates new endpoint rows with new ids — so route matching is the only join
 * that survives a re-import.
 */

/**
 * Rows rendered before the list is expanded.
 *
 * A real specification carries hundreds of operations, and rendering all of
 * them made the project page scroll for several screens before reaching
 * anything else on it — Recent assessments, immediately to the right on a wide
 * viewport, was pushed entirely below the fold on a narrow one. Eight is enough
 * to show the shape of the list and to make a filter's effect visible without
 * expanding.
 */
const COLLAPSED_ROWS = 8;

/** Canonical HTTP ordering, so the method filter never lists PUT before GET. */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'];

export function EndpointsTable({
  endpoints,
  issues = [],
  className,
}: {
  endpoints: Endpoint[];
  /** Issues for this project, used to annotate rows. */
  issues?: SecurityIssue[];
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [tag, setTag] = useState<string>(ALL_TAGS);
  const [expanded, setExpanded] = useState(false);

  const issuesByRoute = useMemo(() => {
    const map = new Map<string, SecurityIssue[]>();
    for (const issue of issues) {
      const key = `${issue.method}|${issue.normalizedRoute}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(issue);
      else map.set(key, [issue]);
    }
    return map;
  }, [issues]);

  const availableMethods = useMemo(() => {
    const present = Array.from(new Set(endpoints.map((e) => e.method)));
    return present.sort((a, b) => {
      const rankA = METHOD_ORDER.indexOf(a);
      const rankB = METHOD_ORDER.indexOf(b);
      // Anything unrecognised sorts alphabetically after the known verbs rather
      // than jumping to the front on an index of -1.
      if (rankA === -1 && rankB === -1) return a.localeCompare(b);
      if (rankA === -1) return 1;
      if (rankB === -1) return -1;
      return rankA - rankB;
    });
  }, [endpoints]);

  const availableTags = useMemo(
    () => Array.from(new Set(endpoints.flatMap((e) => e.tags ?? []))).sort(),
    [endpoints],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return endpoints.filter((endpoint) => {
      const matchesSearch =
        !term ||
        endpoint.path.toLowerCase().includes(term) ||
        endpoint.summary?.toLowerCase().includes(term) ||
        endpoint.tags?.some((t) => t.toLowerCase().includes(term));
      // An empty method selection means every method, not none.
      const matchesMethod = methods.length === 0 || methods.includes(endpoint.method);
      const matchesTag = tag === ALL_TAGS || Boolean(endpoint.tags?.includes(tag));
      return matchesSearch && matchesMethod && matchesTag;
    });
  }, [endpoints, search, methods, tag]);

  /*
   * Narrowing the list collapses it again.
   *
   * Without this, expanding to 300 rows and then filtering to 4 leaves the
   * section expanded, so the next widening of the filter silently dumps
   * hundreds of rows back onto the page. Re-collapsing keeps the page's height
   * a function of the filters rather than of the order they were applied in.
   */
  useEffect(() => {
    setExpanded(false);
  }, [search, methods, tag]);

  if (endpoints.length === 0) {
    return (
      <EmptyState
        icon={IconBraces}
        title="No endpoints imported"
        description="Import an OpenAPI specification for this project to discover its attack surface."
        compact
      />
    );
  }

  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_ROWS);
  const hidden = filtered.length - visible.length;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Search grows, the two selects stay their natural width; all three wrap
          onto their own line on a narrow viewport rather than being squeezed. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoints…"
            className="pl-9"
            aria-label="Search endpoints"
          />
        </div>

        <MethodMultiSelect
          methods={availableMethods}
          selected={methods}
          onChange={setMethods}
        />

        {availableTags.length > 0 && (
          <TagSelect tags={availableTags} value={tag} onChange={setTag} />
        )}
      </div>

      <ActiveFilterChips
        methods={methods}
        tag={tag}
        onClearMethod={(method) => setMethods((current) => current.filter((m) => m !== method))}
        onClearTag={() => setTag(ALL_TAGS)}
      />

      <p className="text-xs text-muted-foreground">
        {filtered.length === endpoints.length
          ? `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}`
          : `${filtered.length} of ${endpoints.length} endpoints`}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={IconBraces} title="No endpoints match these filters" compact />
      ) : (
        <div className="rounded-md border border-border">
          {/*
            Expanding scrolls inside the section instead of growing the page.
            "View all" on a 371-endpoint specification would otherwise trade one
            unusable page for another — the point of collapsing was to keep the
            rest of the project reachable.
          */}
          <ul
            className={cn(
              'divide-y divide-border',
              expanded && 'max-h-[32rem] overflow-y-auto overscroll-contain',
            )}
          >
            {visible.map((endpoint) => {
              const related = issuesByRoute.get(`${endpoint.method}|${endpoint.path}`) ?? [];
              const worst = worstSeverity(related);

              return (
                <li
                  key={endpoint.id}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <MethodBadge method={endpoint.method} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-foreground">{endpoint.path}</p>
                    {endpoint.summary && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {endpoint.summary}
                      </p>
                    )}
                  </div>

                  {endpoint.tags && endpoint.tags.length > 0 && (
                    <div className="hidden flex-shrink-0 gap-1 lg:flex">
                      {endpoint.tags.slice(0, 2).map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="h-5 px-1.5 text-[10px] text-muted-foreground"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {endpoint.deprecated && (
                    <Badge
                      variant="outline"
                      className="h-5 flex-shrink-0 border-severity-medium/30 px-1.5 text-[10px] text-severity-medium"
                    >
                      Deprecated
                    </Badge>
                  )}

                  {/*
                    An endpoint with no issues is shown as "None" rather than
                    left blank: blank reads as "not measured", and these
                    endpoints were in scope.
                  */}
                  <div className="flex w-28 flex-shrink-0 items-center justify-end gap-1.5">
                    {related.length > 0 ? (
                      <>
                        {worst && <SeverityBadge severity={worst as any} size="sm" />}
                        <Button asChild variant="ghost" size="sm" className="h-6 px-1.5">
                          <Link href={`/issues?search=${encodeURIComponent(endpoint.path)}`}>
                            {related.length}
                          </Link>
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">None</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/*
            The expander lives in the list's own footer rather than in a card of
            its own: it is the last row of this table, and giving it a container
            would make a control that is only sometimes present look like a
            separate section of the page.
          */}
          {(hidden > 0 || expanded) && (
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {expanded ? (
                  <>
                    <IconChevronUp className="size-3.5" />
                    Show fewer
                  </>
                ) : (
                  <>
                    View all {filtered.length.toLocaleString()} endpoints
                    <IconArrowRight className="size-3.5" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SEVERITY_RANK = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function worstSeverity(issues: SecurityIssue[]): string | null {
  let worst: string | null = null;
  for (const issue of issues) {
    if (worst === null || SEVERITY_RANK.indexOf(issue.severity) > SEVERITY_RANK.indexOf(worst)) {
      worst = issue.severity;
    }
  }
  return worst;
}
