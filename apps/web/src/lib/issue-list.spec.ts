import { describe, expect, it } from 'bun:test';
import {
  ANY,
  EMPTY_ISSUE_FILTERS,
  hasActiveIssueFilters,
  issuesHref,
  parseIssueFilters,
  parseIssuePage,
  serializeIssueFilters,
  toApiValue,
} from './issue-list';

/**
 * The contract between a summary card and the Issues screen.
 *
 * A card is just a link: it calls `issuesHref`, the screen calls
 * `parseIssueFilters` on what arrives. If those two disagree the card silently
 * lands on an unfiltered list, which is exactly the failure the cards exist to
 * remove — so the round trip is asserted here rather than by clicking.
 */

const params = (query: string) => new URLSearchParams(query);

describe('parseIssueFilters', () => {
  it('returns the empty state for a bare URL', () => {
    expect(parseIssueFilters(params(''))).toEqual(EMPTY_ISSUE_FILTERS);
  });

  it('reads severity and status case-insensitively', () => {
    expect(parseIssueFilters(params('severity=critical&status=open'))).toEqual({
      search: '',
      severity: 'CRITICAL',
      status: 'OPEN',
    });
  });

  it('falls back to "all" for values outside the enums', () => {
    // These would be a 400 from the API, so they must never reach the request.
    const filters = parseIssueFilters(params('severity=URGENT&status=DONE'));
    expect(filters.severity).toBe(ANY);
    expect(filters.status).toBe(ANY);
    expect(toApiValue(filters.severity)).toBeUndefined();
  });

  it('reads the search term from q', () => {
    expect(parseIssueFilters(params('q=token')).search).toBe('token');
  });
});

describe('parseIssuePage', () => {
  it('defaults to the first page and never goes below it', () => {
    expect(parseIssuePage(params(''))).toBe(1);
    expect(parseIssuePage(params('page=0'))).toBe(1);
    expect(parseIssuePage(params('page=-3'))).toBe(1);
    expect(parseIssuePage(params('page=nope'))).toBe(1);
  });

  it('reads a real page number', () => {
    expect(parseIssuePage(params('page=4'))).toBe(4);
  });
});

describe('serializeIssueFilters', () => {
  it('omits every default, including page 1', () => {
    expect(serializeIssueFilters(EMPTY_ISSUE_FILTERS)).toBe('');
    expect(serializeIssueFilters(EMPTY_ISSUE_FILTERS, 1)).toBe('');
  });

  it('round-trips a fully populated state', () => {
    const state = { search: 'jwt', severity: 'HIGH', status: 'ACKNOWLEDGED' };
    const query = serializeIssueFilters(state, 3);

    expect(parseIssueFilters(params(query))).toEqual(state);
    expect(parseIssuePage(params(query))).toBe(3);
  });

  it('trims the search term', () => {
    expect(serializeIssueFilters({ ...EMPTY_ISSUE_FILTERS, search: '  jwt  ' })).toBe('q=jwt');
  });
});

describe('issuesHref', () => {
  it('links to the unfiltered list when given nothing', () => {
    expect(issuesHref()).toBe('/issues');
  });

  it('builds the links the summary cards use', () => {
    expect(issuesHref({ severity: 'CRITICAL' })).toBe('/issues?severity=CRITICAL');
    expect(issuesHref({ status: 'OPEN' })).toBe('/issues?status=OPEN');
  });

  it('produces a state the screen parses back unchanged', () => {
    const href = issuesHref({ severity: 'CRITICAL', status: 'OPEN' });
    const filters = parseIssueFilters(params(href.split('?')[1] ?? ''));

    expect(filters).toEqual({ search: '', severity: 'CRITICAL', status: 'OPEN' });
    expect(hasActiveIssueFilters(filters)).toBe(true);
  });
});

describe('hasActiveIssueFilters', () => {
  it('is false only when nothing is applied', () => {
    expect(hasActiveIssueFilters(EMPTY_ISSUE_FILTERS)).toBe(false);
    expect(hasActiveIssueFilters({ ...EMPTY_ISSUE_FILTERS, search: 'a' })).toBe(true);
    expect(hasActiveIssueFilters({ ...EMPTY_ISSUE_FILTERS, severity: 'LOW' })).toBe(true);
  });
});
