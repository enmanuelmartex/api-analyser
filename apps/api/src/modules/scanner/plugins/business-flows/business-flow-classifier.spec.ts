import { describe, expect, it } from 'bun:test';
import {
  classifyBusinessFlow,
  flowKindLabel,
  isHighImpactFlow,
} from './business-flow-classifier';

/**
 * Classification is the only part of the API6 check that infers rather than
 * observes, so it is the part that decides whether the check is trustworthy.
 * The cases below are split accordingly: what must be recognised, and — more
 * importantly — what must not be.
 */

const endpoint = (path: string, method = 'POST', extra: Record<string, any> = {}) => ({
  path,
  method,
  ...extra,
});

describe('classifyBusinessFlow — recognising a flow', () => {
  it('reads the flow from the path', () => {
    const match = classifyBusinessFlow(endpoint('/v1/orders'))!;

    expect(match.kind).toBe('ORDER');
    expect(match.term).toBe('order');
    expect(match.matchedIn).toBe('path');
  });

  it('handles camelCase and snake_case operation names', () => {
    expect(classifyBusinessFlow(endpoint('/account/resetPassword'))!.kind).toBe('ACCOUNT');
    expect(classifyBusinessFlow(endpoint('/redeem_voucher'))!.kind).toBe('REWARD');
  });

  it('falls back to the summary when the path is opaque', () => {
    const match = classifyBusinessFlow(
      endpoint('/v2/x7', 'POST', { summary: 'Create a booking for a listing' }),
    )!;

    expect(match.kind).toBe('BOOKING');
    expect(match.matchedIn).toBe('summary');
  });

  it('falls back to tags last', () => {
    const match = classifyBusinessFlow(
      endpoint('/v2/x7', 'POST', { summary: 'Create a record', tags: ['payments'] }),
    )!;

    expect(match.kind).toBe('PAYMENT');
    expect(match.matchedIn).toBe('tag');
  });

  it('ignores path parameters, which name identifiers rather than operations', () => {
    // `{orderId}` must not make an attachment endpoint an ordering flow.
    expect(classifyBusinessFlow(endpoint('/widgets/{orderId}/attach'))).toBeNull();
  });

  it('prefers the most business-critical reading when a path matches twice', () => {
    // Stable priority matters beyond taste: the kind reaches the finding text,
    // and a kind that flips between runs would churn the issue it produces.
    expect(classifyBusinessFlow(endpoint('/orders/{id}/payments'))!.kind).toBe('PAYMENT');
  });
});

describe('classifyBusinessFlow — refusing to guess', () => {
  it('does not match a term inside a longer word', () => {
    // Each of these contains a flow term as a substring. A substring matcher
    // reports all four, and the check becomes noise its users learn to skip.
    expect(classifyBusinessFlow(endpoint('/reports/generate'))).toBeNull(); // "rate"
    expect(classifyBusinessFlow(endpoint('/bookmarks'))).toBeNull();        // "book"
    expect(classifyBusinessFlow(endpoint('/coordinates'))).toBeNull();      // "ordinate"
    expect(classifyBusinessFlow(endpoint('/payloads'))).toBeNull();         // "pay"
  });

  it('leaves read operations to the rate-limit check', () => {
    // A missing throttle on a GET is already reported against API4. Reporting
    // it here as well would double-count one observation on one endpoint.
    expect(classifyBusinessFlow(endpoint('/checkout', 'GET'))).toBeNull();
  });

  it('never probes DELETE', () => {
    // The probe repeats the request; repeating a delete is not something a
    // scanner may decide to do on a live system.
    expect(classifyBusinessFlow(endpoint('/orders/{id}', 'DELETE'))).toBeNull();
  });

  it('leaves authentication endpoints to the authentication checks', () => {
    expect(classifyBusinessFlow(endpoint('/auth/login'))).toBeNull();
    expect(classifyBusinessFlow(endpoint('/oauth/token'))).toBeNull();
  });

  it('returns null for an endpoint whose naming says nothing about a flow', () => {
    expect(classifyBusinessFlow(endpoint('/v1/widgets'))).toBeNull();
  });
});

describe('flow impact', () => {
  it('separates flows that cost money per repetition from those that produce junk', () => {
    expect(isHighImpactFlow('PAYMENT')).toBe(true);
    expect(isHighImpactFlow('MESSAGING')).toBe(true);
    expect(isHighImpactFlow('CONTENT')).toBe(false);
  });

  it('labels every kind, so no finding title can render undefined', () => {
    const kinds = ['PAYMENT', 'ORDER', 'BOOKING', 'ACCOUNT', 'MESSAGING', 'CONTENT', 'REWARD'] as const;

    for (const kind of kinds) {
      expect(flowKindLabel(kind).length).toBeGreaterThan(0);
    }
  });
});
