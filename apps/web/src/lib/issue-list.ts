import type { IssueStatus, Severity } from '@/types';
import { SEVERITY_ORDER } from '@/components/security/severity-badge';

/**
 * Issue list filter state, expressed as URL search params.
 *
 * The Issues screen used to hold this in `useState`, which made a filtered view
 * impossible to link to, share or restore after a reload — and made the summary
 * cards above the list unable to do anything. Filters now live in the URL, the
 * same place the Projects, Scans and Reports screens keep theirs, so the cards
 * are ordinary links and the selects read their value back out of the URL.
 *
 * `q` matches the param the other list screens already use for free text.
 */

/**
 * "No filter" needs a real value: Radix reserves the empty string for "nothing
 * selected", which would leave the trigger blank instead of reading "All".
 * It is mapped back to `undefined` before the request goes out.
 */
export const ANY = 'all';

export type IssueFilterState = {
  search: string;
  /** A `Severity` value, or `ANY`. */
  severity: string;
  /** An `IssueStatus` value, or `ANY`. */
  status: string;
};

export const EMPTY_ISSUE_FILTERS: IssueFilterState = {
  search: '',
  severity: ANY,
  status: ANY,
};

/**
 * Triage states in the order an issue moves through them. Sentence case rather
 * than the badge's SCREAMING_CASE: these label form controls, not badges.
 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  ACCEPTED_RISK: 'Accepted risk',
  FALSE_POSITIVE: 'False positive',
};

const STATUS_VALUES = Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[];

/** `ANY` is a UI-only sentinel; the API expects the enum value or nothing. */
export function toApiValue(value: string): string | undefined {
  return value === ANY ? undefined : value;
}

export function hasActiveIssueFilters(value: IssueFilterState): boolean {
  return Boolean(value.search) || value.severity !== ANY || value.status !== ANY;
}

/**
 * Unknown values fall back to `ANY` rather than reaching the API, which rejects
 * anything outside the enum with a 400. Values are read case-insensitively so a
 * hand-written `?severity=critical` behaves like the canonical `CRITICAL`.
 */
export function parseIssueFilters(params: URLSearchParams): IssueFilterState {
  const severity = (params.get('severity') ?? '').toUpperCase();
  const status = (params.get('status') ?? '').toUpperCase();

  return {
    search: params.get('q') ?? '',
    severity: SEVERITY_ORDER.includes(severity as Severity) ? severity : ANY,
    status: STATUS_VALUES.includes(status as IssueStatus) ? status : ANY,
  };
}

export function parseIssuePage(params: URLSearchParams): number {
  return Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
}

export function serializeIssueFilters(state: IssueFilterState, page = 1): string {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.severity !== ANY) params.set('severity', state.severity);
  if (state.status !== ANY) params.set('status', state.status);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

/**
 * The link a summary card points at. Every "View critical / View open issues"
 * destination in the product is built here, so a card can only ever produce a
 * filter the Issues screen knows how to read back.
 */
export function issuesHref(overrides: Partial<IssueFilterState> = {}): string {
  const query = serializeIssueFilters({ ...EMPTY_ISSUE_FILTERS, ...overrides });
  return query ? `/issues?${query}` : '/issues';
}
