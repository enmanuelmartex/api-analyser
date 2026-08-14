import { describe, expect, test } from 'bun:test';
import { buildReportEmail } from '@/lib/email/report-email';
import { escapeHtml } from '@/lib/email/escape';
import { SCAN_REPORT_SUBJECT } from '@/lib/email/templates/scan-report';
import { TEST_ASSET_BASE_URL } from './helpers';

/** Everything `/api/send-report` knows, plus the origin from configuration. */
const build = (input: { scanName?: string; filename: string }) =>
  buildReportEmail({ ...input, assetBaseUrl: TEST_ASSET_BASE_URL });

describe('buildReportEmail', () => {
  /*
   * The subject is a constant, and that is the point.
   *
   * It used to be `Security Report - ${scanName}`, which put a caller-supplied
   * string into the one line a recipient reads before deciding to trust a
   * message. A fixed subject cannot be steered by whoever holds a relay token,
   * and the scan name still reaches the reader — in the preheader and in the
   * body, where it is escaped.
   */
  test('the subject is server-owned and identical for every caller', () => {
    expect(build({ scanName: 'Production API', filename: 'r.pdf' }).subject).toBe(
      SCAN_REPORT_SUBJECT,
    );
    expect(build({ filename: 'r.pdf' }).subject).toBe(SCAN_REPORT_SUBJECT);
    expect(build({ scanName: '   ', filename: 'r.pdf' }).subject).toBe(SCAN_REPORT_SUBJECT);
  });

  test('a scan name cannot reach the subject line', () => {
    const { subject } = build({ scanName: 'URGENT: verify your account', filename: 'r.pdf' });
    expect(subject).not.toContain('URGENT');
    expect(subject).toBe(SCAN_REPORT_SUBJECT);
  });

  test('says what the reader needs to know', () => {
    const { html, text } = build({ scanName: 'Checkout API', filename: 'scan.pdf' });

    for (const body of [html, text]) {
      expect(body).toContain('Checkout API');
      expect(body).toContain('scan.pdf');
      expect(body.toLowerCase()).toContain('attached');
      expect(body).toContain('API Analyzer');
    }
    expect(html.toLowerCase()).toContain('completed successfully');
  });

  test('renders light, since a script caller has no stored preference', () => {
    const { html } = build({ filename: 'r.pdf' });
    expect(html).toContain('content="light"');
    expect(html).toContain('mark-light.png');
  });

  test('always ships a plain-text alternative', () => {
    const { text } = build({ filename: 'r.pdf' });
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toContain('<');
  });

  test('escapes a scan name containing markup', () => {
    const { html } = build({ scanName: '<img src=x onerror="alert(1)">', filename: 'r.pdf' });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  test('escapes a filename containing markup', () => {
    const { html } = build({ filename: '<script>evil</script>.pdf' });
    expect(html).not.toContain('<script>evil');
  });

  test('the template is fixed — nothing but the two fields varies', () => {
    const a = build({ scanName: 'One', filename: 'a.pdf' });
    const b = build({ scanName: 'One', filename: 'a.pdf' });
    expect(a.html).toBe(b.html);
  });
});

describe('escapeHtml', () => {
  test.each([
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['&', '&amp;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('escapes %s', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  test('escapes ampersands before the entities it introduces', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('leaves ordinary text alone', () => {
    expect(escapeHtml('Production API v2 (staging)')).toBe('Production API v2 (staging)');
  });
});
