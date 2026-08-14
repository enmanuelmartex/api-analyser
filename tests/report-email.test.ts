import { describe, expect, test } from 'bun:test';
import { buildReportEmail } from '@/lib/email/report-email';
import { escapeHtml } from '@/lib/email/escape';

describe('buildReportEmail', () => {
  test('uses the scan name in the subject when there is one', () => {
    const { subject } = buildReportEmail({ scanName: 'Production API', filename: 'r.pdf' });
    expect(subject).toBe('Security Report - Production API');
  });

  test('falls back to a generic subject without one', () => {
    expect(buildReportEmail({ filename: 'r.pdf' }).subject).toBe('API Security Report');
  });

  test('treats a blank scan name as absent', () => {
    expect(buildReportEmail({ scanName: '   ', filename: 'r.pdf' }).subject).toBe(
      'API Security Report',
    );
  });

  test('says what the reader needs to know', () => {
    const { html, text } = buildReportEmail({ scanName: 'Checkout API', filename: 'scan.pdf' });

    for (const body of [html, text]) {
      expect(body).toContain('Checkout API');
      expect(body).toContain('scan.pdf');
      expect(body.toLowerCase()).toContain('attached');
      expect(body).toContain('API Analyzer');
    }
    expect(html.toLowerCase()).toContain('finished');
    expect(html.toLowerCase()).toContain('generated successfully');
  });

  test('always ships a plain-text alternative', () => {
    const { text } = buildReportEmail({ filename: 'r.pdf' });
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toContain('<');
  });

  test('escapes a scan name containing markup', () => {
    const { html } = buildReportEmail({
      scanName: '<img src=x onerror="alert(1)">',
      filename: 'r.pdf',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  test('escapes a filename containing markup', () => {
    const { html } = buildReportEmail({ filename: '<script>evil</script>.pdf' });
    expect(html).not.toContain('<script>evil');
  });

  test('the template is fixed — nothing but the two fields varies', () => {
    const a = buildReportEmail({ scanName: 'One', filename: 'a.pdf' });
    const b = buildReportEmail({ scanName: 'One', filename: 'a.pdf' });
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
