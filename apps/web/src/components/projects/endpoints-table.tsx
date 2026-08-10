'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconBraces, IconSearch } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { MethodBadge } from '@/components/security/method-badge';
import { SeverityBadge } from '@/components/security/severity-badge';
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

const ALL_METHODS = 'ALL';

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
  const [method, setMethod] = useState<string>(ALL_METHODS);
  const [tag, setTag] = useState<string>(ALL_METHODS);

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

  const methods = useMemo(
    () => [ALL_METHODS, ...Array.from(new Set(endpoints.map((e) => e.method))).sort()],
    [endpoints],
  );

  const tags = useMemo(
    () => [ALL_METHODS, ...Array.from(new Set(endpoints.flatMap((e) => e.tags ?? []))).sort()],
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
      const matchesMethod = method === ALL_METHODS || endpoint.method === method;
      const matchesTag = tag === ALL_METHODS || endpoint.tags?.includes(tag);
      return matchesSearch && matchesMethod && matchesTag;
    });
  }, [endpoints, search, method, tag]);

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

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search path, summary or tag…"
            className="pl-9"
            aria-label="Search endpoints"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {methods.map((m) => (
            <FilterChip key={m} active={method === m} onClick={() => setMethod(m)}>
              {m === ALL_METHODS ? 'All methods' : m}
            </FilterChip>
          ))}
        </div>
      </div>

      {tags.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.slice(0, 12).map((t) => (
            <FilterChip key={t} active={tag === t} onClick={() => setTag(t)}>
              {t === ALL_METHODS ? 'All tags' : t}
            </FilterChip>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {endpoints.length} endpoints
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={IconBraces} title="No endpoints match these filters" compact />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <ul className="divide-y divide-border">
            {filtered.map((endpoint) => {
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
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {children}
    </button>
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
