import { describe, expect, test } from 'bun:test';
import { safeUrl } from '@/lib/email/layout';
import {
  renderCriticalFinding,
  renderScanFailed,
  renderScanReport,
  renderTemplate,
  TEMPLATE_NAMES,
} from '@/lib/email/templates';

describe('safeUrl', () => {
  test.each([
    'https://app.example.com/reports/1',
    'http://localhost:3000/reports/1',
    'https://192.168.1.5:8443/issues?severity=CRITICAL',
  ])('accepts %s', (url) => {
    expect(safeUrl(url)).toBeDefined();
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'not a url at all',
    '',
  ])('rejects %s', (url) => {
    expect(safeUrl(url)).toBeUndefined();
  });

  test('rejects an absurdly long URL', () => {
    expect(safeUrl(`https://example.com/${'a'.repeat(4000)}`)).toBeUndefined();
  });

  test('tolerates undefined', () => {
    expect(safeUrl(undefined)).toBeUndefined();
  });
});

describe('renderScanReport', () => {
  test('names the project in the subject', () => {
    expect(renderScanReport({ projectName: 'Checkout API' }).subject).toBe(
      'Security Report - Checkout API',
    );
  });

  test('falls back to a generic subject without one', () => {
    expect(renderScanReport({ projectName: '' }).subject).toBe('API Security Report');
  });

  test('omits the score and breakdown when they are absent', () => {
    const { html } = renderScanReport({ projectName: 'X' });
    expect(html).not.toContain('Security score');
    expect(html).not.toContain('Findings by severity');
  });

  test('renders the breakdown when present, including zeroes', () => {
    const { html, text } = renderScanReport({
      projectName: 'X',
      counts: { critical: 0, high: 2, medium: 0, low: 1, info: 4 },
    });

    expect(html).toContain('Findings by severity');
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      expect(html).toContain(label);
      expect(text).toContain(label);
    }
  });

  test('mentions the attachment only when there is one', () => {
    expect(renderScanReport({ projectName: 'X' }, 'r.pdf').html).toContain('attached');
    expect(renderScanReport({ projectName: 'X' }).html).not.toContain('attached to this email');
  });

  test('drops an unsafe report URL rather than the whole email', () => {
    const { html } = renderScanReport({ projectName: 'X', reportUrl: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Your security report is ready');
  });

  test('prints the destination of a link in visible text', () => {
    // So a recipient on a phone, who cannot hover, still sees where it goes.
    const { html } = renderScanReport({
      projectName: 'X',
      reportUrl: 'https://app.example.com/reports/1',
    });
    const occurrences = html.split('https://app.example.com/reports/1').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('renderScanFailed', () => {
  test('states the project and the reason', () => {
    const { subject, html, text } = renderScanFailed({
      projectName: 'Payment API',
      reason: 'connect ETIMEDOUT 10.0.0.1:443',
    });

    expect(subject).toBe('Security Scan Failed - Payment API');
    expect(html).toContain('connect ETIMEDOUT');
    expect(text).toContain('connect ETIMEDOUT');
  });

  test('says the schedule will retry, only when it came from one', () => {
    expect(
      renderScanFailed({ projectName: 'X', reason: 'r', scheduleName: 'Nightly' }).html,
    ).toContain('try again');
    expect(renderScanFailed({ projectName: 'X', reason: 'r' }).html).not.toContain('try again');
  });

  test('escapes markup in the reason', () => {
    const { html } = renderScanFailed({
      projectName: 'X',
      reason: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)');
  });
});

describe('renderCriticalFinding', () => {
  test('agrees with itself about plurals', () => {
    expect(renderCriticalFinding({ projectName: 'X', criticalCount: 1 }).subject).toContain(
      '1 vulnerability',
    );
    expect(renderCriticalFinding({ projectName: 'X', criticalCount: 3 }).subject).toContain(
      '3 vulnerabilities',
    );
  });
});

describe('every template', () => {
  const samples = [
    renderScanReport({ projectName: 'X' }, 'r.pdf'),
    renderScanFailed({ projectName: 'X', reason: 'r' }),
    renderCriticalFinding({ projectName: 'X', criticalCount: 1 }),
  ];

  test('carries a non-empty subject, html and text', () => {
    for (const rendered of samples) {
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.html).toContain('<!doctype html>');
      expect(rendered.text.length).toBeGreaterThan(50);
    }
  });

  test('ships a plain-text alternative with no markup in it', () => {
    for (const { text } of samples) {
      expect(text).not.toContain('<');
    }
  });

  test('is branded and says why it arrived', () => {
    for (const { html, text } of samples) {
      expect(html).toContain('API');
      expect(html).toContain('This mailbox is not monitored');
      expect(text).toContain('API Analyzer');
    }
  });

  test('has no line break in its subject', () => {
    // A newline here is header injection, so it is asserted on the output
    // rather than only on the input validation.
    for (const { subject } of samples) {
      expect(subject).not.toContain('\n');
      expect(subject).not.toContain('\r');
    }
  });
});

describe('renderTemplate', () => {
  test('dispatches every declared template name', () => {
    expect(TEMPLATE_NAMES).toEqual(['scan-report', 'scan-failed', 'critical-finding']);

    expect(
      renderTemplate({ template: 'scan-report', data: { projectName: 'X' } }).subject,
    ).toContain('X');
    expect(
      renderTemplate({ template: 'scan-failed', data: { projectName: 'X', reason: 'r' } }).subject,
    ).toContain('X');
    expect(
      renderTemplate({ template: 'critical-finding', data: { projectName: 'X', criticalCount: 1 } })
        .subject,
    ).toContain('X');
  });
});
