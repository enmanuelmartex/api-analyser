import { describe, expect, test } from 'bun:test';
import {
  renderTemplate,
  renderCriticalFinding,
  renderScanFailed,
  renderScanReport,
  renderWeeklySummary,
  TEMPLATE_NAMES,
  type RenderOptions,
} from '@/lib/email/templates';
import { DARK, LIGHT, themeFor, type ThemeName } from '@/lib/email/theme';
import { safeUrl } from '@/lib/validation/url';
import { TEST_ASSET_BASE_URL } from './helpers';

const opts = (theme?: ThemeName): RenderOptions => ({
  theme,
  assetBaseUrl: TEST_ASSET_BASE_URL,
});

const SCAN_DATA = {
  userName: 'Ada',
  projectName: 'Checkout API',
  securityScore: 37,
  riskLevel: 'HIGH' as const,
  counts: { critical: 2, high: 3, medium: 4, low: 5, info: 6 },
  totalFindings: 20,
  endpointsEvaluated: 12,
  scanDate: '2026-08-13',
  reportUrl: 'https://app.example.test/reports/abc',
};

const WEEKLY_DATA = {
  userName: 'Ada',
  dateFrom: '2026-08-07',
  dateTo: '2026-08-13',
  assessments: { count: 14, changePercent: 12 },
  findings: { count: 23, changePercent: -8 },
  critical: { count: 3, changePercent: 0 },
  activeProjects: 3,
  dashboardUrl: 'https://app.example.test/dashboard',
};

/** Every template, rendered both ways, for the checks that apply to all of them. */
const EVERY_RENDER = (['light', 'dark'] as const).flatMap((theme) => [
  { name: 'scan-report', theme, ...renderScanReport({ data: SCAN_DATA, ...opts(theme) }) },
  {
    name: 'scan-failed',
    theme,
    ...renderScanFailed({
      data: { userName: 'Ada', projectName: 'Checkout API', reason: 'Connection refused' },
      ...opts(theme),
    }),
  },
  {
    name: 'critical-finding',
    theme,
    ...renderCriticalFinding({
      data: { userName: 'Ada', projectName: 'Checkout API', criticalCount: 2 },
      ...opts(theme),
    }),
  },
  { name: 'weekly-summary', theme, ...renderWeeklySummary({ data: WEEKLY_DATA, ...opts(theme) }) },
]);

describe('scan-report', () => {
  test('renders the reference layout: title, greeting, summary card, findings, CTA', () => {
    const { html } = renderScanReport({ data: SCAN_DATA, ...opts('light') });

    expect(html).toContain('Assessment completed');
    expect(html).toContain('Hi Ada,');
    expect(html).toContain('Checkout API');
    expect(html).toContain('37 / 100');
    expect(html).toContain('High');
    expect(html).toContain('August 13, 2026');
    expect(html).toContain('20');
    expect(html).toContain('12');
    expect(html).toContain('View Full Report');
    expect(html).toContain('https://app.example.test/reports/abc');
  });

  test('the subject is a constant and carries no caller data', () => {
    const a = renderScanReport({ data: SCAN_DATA, ...opts() });
    const b = renderScanReport({
      data: { ...SCAN_DATA, projectName: 'Something Else Entirely' },
      ...opts(),
    });
    expect(a.subject).toBe(b.subject);
    expect(a.subject).toBe('Assessment completed — API Analyzer');
  });

  test('omits every row it has no value for, rather than printing a placeholder', () => {
    const { html, text } = renderScanReport({
      data: { projectName: 'Bare' },
      ...opts(),
    });

    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('/ 100');
    expect(html).not.toContain('>Risk<');
    expect(html).not.toContain('>Date<');
    expect(text).not.toContain('undefined');
  });

  test('a null score is omitted, not rendered as zero', () => {
    const { html } = renderScanReport({
      data: { projectName: 'Bare', securityScore: null },
      ...opts(),
    });
    expect(html).not.toContain('0 / 100');
    expect(html).not.toContain('/ 100');
  });

  test('greets neutrally when there is no name on file', () => {
    const { html } = renderScanReport({ data: { projectName: 'X' }, ...opts() });
    expect(html).toContain('Hi,');
    expect(html).not.toContain('Hi undefined');
  });

  test('names the attachment when there is one', () => {
    const { html, text } = renderScanReport({
      data: SCAN_DATA,
      ...opts(),
      attachedFilename: 'report-2026-08-13.pdf',
    });
    expect(html).toContain('report-2026-08-13.pdf');
    expect(text).toContain('report-2026-08-13.pdf');
  });

  test('renders the severity breakdown it was given', () => {
    const { html } = renderScanReport({ data: SCAN_DATA, ...opts() });
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      expect(html).toContain(label);
    }
  });

  test('drops the button when there is no link, rather than pointing it nowhere', () => {
    const { html } = renderScanReport({
      data: { projectName: 'X', reportUrl: undefined },
      ...opts(),
    });
    expect(html).not.toContain('View Full Report');
  });

  test.each([
    ['LOW', 'Low'],
    ['MEDIUM', 'Medium'],
    ['HIGH', 'High'],
    ['CRITICAL', 'Critical'],
  ] as const)('spells risk %s as %s', (level, label) => {
    const { html } = renderScanReport({
      data: { projectName: 'X', riskLevel: level },
      ...opts(),
    });
    expect(html).toContain(`>${label}</td>`);
  });

  test('singularises a single finding', () => {
    const { html } = renderScanReport({
      data: { projectName: 'X', totalFindings: 1, endpointsEvaluated: 1 },
      ...opts(),
    });
    expect(html).toContain('1</strong> finding was detected');
    expect(html).toContain('1</strong> endpoint evaluated');
  });

  test('pluralises several findings', () => {
    const { html } = renderScanReport({
      data: { projectName: 'X', totalFindings: 3, endpointsEvaluated: 12 },
      ...opts(),
    });
    expect(html).toContain('3</strong> findings were detected');
    expect(html).toContain('12</strong> endpoints evaluated');
  });
});

describe('weekly-summary', () => {
  test('renders the reference layout: title, range, four tiles, CTA', () => {
    const { html } = renderWeeklySummary({ data: WEEKLY_DATA, ...opts('light') });

    expect(html).toContain('Weekly Summary');
    expect(html).toContain('Hi Ada,');
    expect(html).toContain('August 7 – 13, 2026');
    for (const label of ['Assessments', 'Findings', 'Critical', 'Projects']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('+12%');
    expect(html).toContain('-8%');
    expect(html).toContain('0%');
    expect(html).toContain('active');
    expect(html).toContain('View Dashboard');
  });

  /*
   * The tone rule, which is the one piece of logic in this template that is
   * easy to get backwards and expensive to get wrong: more assessments is
   * progress, more findings is a regression, and both are `+`.
   */
  test('colours a rise in assessments as good and a rise in findings as bad', () => {
    const { html } = renderWeeklySummary({
      data: {
        ...WEEKLY_DATA,
        assessments: { count: 10, changePercent: 20 },
        findings: { count: 10, changePercent: 20 },
        critical: { count: 10, changePercent: 20 },
      },
      ...opts('light'),
    });

    // One green +20% for assessments, two red ones for findings and criticals.
    const green = html.split(`color:${LIGHT.positive};">+20%`).length - 1;
    const red = html.split(`color:${LIGHT.negative};">+20%`).length - 1;
    expect(green).toBe(1);
    expect(red).toBe(2);
  });

  test('colours a drop in findings as good', () => {
    const { html } = renderWeeklySummary({
      data: { ...WEEKLY_DATA, findings: { count: 5, changePercent: -30 } },
      ...opts('light'),
    });
    expect(html).toContain(`color:${LIGHT.positive};">-30%`);
  });

  test('a zero change is neutral, not green', () => {
    const { html } = renderWeeklySummary({
      data: { ...WEEKLY_DATA, assessments: { count: 4, changePercent: 0 } },
      ...opts('light'),
    });
    expect(html).toContain(`color:${LIGHT.muted};">0%`);
  });

  /*
   * The requirement from the brief, stated as a test: a previous week of zero
   * must not produce `Infinity%` or `NaN%`. The API sends null, and null means
   * the comparison line is dropped entirely rather than fabricated.
   */
  test('a null change renders no percentage at all', () => {
    const { html, text } = renderWeeklySummary({
      data: {
        ...WEEKLY_DATA,
        assessments: { count: 7, changePercent: null },
        findings: { count: 0, changePercent: null },
        critical: { count: 0, changePercent: null },
      },
      ...opts(),
    });

    expect(html).not.toContain('Infinity');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('vs last week');
    // No percentage in any rendered text node. Anchored to the surrounding
    // tags rather than searching for a bare "%", which legitimately appears in
    // the layout's `width="50%"` and `width:100%`.
    expect(html).not.toMatch(/>[+-]?\d+%</);
    expect(text).toContain('no comparison available');
  });

  test.each([
    ['2026-08-07', '2026-08-13', 'August 7 – 13, 2026'],
    ['2026-08-28', '2026-09-03', 'August 28 – September 3, 2026'],
    ['2025-12-29', '2026-01-04', 'December 29, 2025 – January 4, 2026'],
  ])('formats the range %s..%s as "%s"', (from, to, expected) => {
    const { html } = renderWeeklySummary({
      data: { ...WEEKLY_DATA, dateFrom: from, dateTo: to },
      ...opts(),
    });
    expect(html).toContain(expected);
  });

  test('the subject is a constant', () => {
    expect(renderWeeklySummary({ data: WEEKLY_DATA, ...opts() }).subject).toBe(
      'Your weekly summary — API Analyzer',
    );
  });

  test('separates thousands so a big number stays readable', () => {
    const { html } = renderWeeklySummary({
      data: { ...WEEKLY_DATA, findings: { count: 1204, changePercent: null } },
      ...opts(),
    });
    expect(html).toContain('1,204');
  });
});

describe('themes', () => {
  test.each(['light', 'dark'] as const)('%s renders its own palette and logo', (name) => {
    const tokens = themeFor(name);
    const { html } = renderScanReport({ data: SCAN_DATA, ...opts(name) });

    expect(html).toContain(`background-color:${tokens.canvas}`);
    expect(html).toContain(`background-color:${tokens.surface}`);
    expect(html).toContain(tokens.ink);
    expect(html).toContain(`${TEST_ASSET_BASE_URL}/brand/${tokens.logoFile}`);
    expect(html).toContain(`content="${name}"`);
  });

  test('light and dark differ in colour but say the same things', () => {
    const light = renderScanReport({ data: SCAN_DATA, ...opts('light') });
    const dark = renderScanReport({ data: SCAN_DATA, ...opts('dark') });

    expect(light.html).not.toBe(dark.html);
    // The text alternative carries no colour, so it must be byte-identical —
    // which is what proves the two variants are one message, not two.
    expect(light.text).toBe(dark.text);
  });

  test('an absent theme falls back to light', () => {
    expect(renderScanReport({ data: SCAN_DATA, ...opts() }).html).toBe(
      renderScanReport({ data: SCAN_DATA, ...opts('light') }).html,
    );
  });

  test('the dark palette is a real design, not an inversion', () => {
    // Container lifted off the canvas, cards lifted again: three distinct
    // surfaces, which is what a naive inversion of the light palette loses.
    expect(new Set([DARK.canvas, DARK.surface, DARK.card]).size).toBe(3);
    expect(DARK.canvas).not.toBe(LIGHT.surface);
    // Near-black ink on the lifted blue, per the product's own dark tokens.
    expect(DARK.onAccent).not.toBe('#ffffff');
  });

  test('declares its colour scheme so clients do not invert it', () => {
    for (const { html, theme, name } of EVERY_RENDER) {
      expect(html, name).toContain(`<meta name="color-scheme" content="${theme}" />`);
      expect(html, name).toContain(`supported-color-schemes:${theme}`);
    }
  });
});

describe('email-client compatibility', () => {
  test('every layout table is presentational and has the attributes Outlook reads', () => {
    for (const { html, name } of EVERY_RENDER) {
      const tables = html.match(/<table[^>]*>/g) ?? [];
      expect(tables.length, name).toBeGreaterThan(0);
      for (const tag of tables) {
        expect(tag, `${name}: ${tag}`).toContain('role="presentation"');
        expect(tag, `${name}: ${tag}`).toContain('border="0"');
        expect(tag, `${name}: ${tag}`).toContain('cellpadding="0"');
        expect(tag, `${name}: ${tag}`).toContain('cellspacing="0"');
      }
    }
  });

  test('carries nothing a mail client strips or flags', () => {
    for (const { html, name } of EVERY_RENDER) {
      expect(html, name).not.toContain('<script');
      expect(html, name).not.toContain('<form');
      expect(html, name).not.toContain('<iframe');
      expect(html, name).not.toContain('javascript:');
      expect(html, name).not.toContain('onerror=');
      expect(html, name).not.toContain('onclick=');
      expect(html, name).not.toContain('background-image');
      expect(html, name).not.toContain('@media');
      expect(html, name).not.toContain('display:flex');
      expect(html, name).not.toContain('display:grid');
      expect(html, name).not.toContain('position:absolute');
      // A web font is a request most clients block and some flag.
      expect(html, name).not.toContain('@font-face');
      expect(html, name).not.toContain('fonts.googleapis');
    }
  });

  test('the only remote request is the logo, on this deployment', () => {
    for (const { html, name } of EVERY_RENDER) {
      const sources = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);
      for (const source of sources) {
        expect(source, name).toStartWith(`${TEST_ASSET_BASE_URL}/brand/`);
      }
    }
  });

  test('every image has alt text and explicit dimensions', () => {
    for (const { html, name } of EVERY_RENDER) {
      for (const tag of html.match(/<img[^>]*>/g) ?? []) {
        expect(tag, name).toContain('alt="API Analyzer"');
        expect(tag, name).toContain('width="32"');
        expect(tag, name).toContain('height="32"');
      }
    }
  });

  test('ships a plain-text alternative that is genuinely plain', () => {
    for (const { text, name } of EVERY_RENDER) {
      expect(text.length, name).toBeGreaterThan(80);
      expect(text, name).not.toContain('<');
      expect(text, name).toContain('API Analyzer');
      expect(text, name).not.toContain('undefined');
      expect(text, name).not.toContain('NaN');
    }
  });

  test('carries a preheader so the inbox preview is not the word "API Analyzer"', () => {
    for (const { html, name } of EVERY_RENDER) {
      expect(html, name).toContain('mso-hide:all');
    }
  });

  test('stays within a width a phone renders without scaling', () => {
    for (const { html, name } of EVERY_RENDER) {
      expect(html, name).toContain('max-width:600px');
      expect(html, name).toContain('width="600"');
    }
  });
});

describe('escaping', () => {
  /*
   * A project name is whatever somebody typed into a form. It reaches these
   * templates unmodified, and this relay sends from a verified security domain
   * — so markup in a project title becoming markup in an inbox is the one
   * cross-site failure this service could actually have.
   */
  const MARKUP = '<img src=x onerror="alert(1)">';

  test.each([
    [
      'scan-report',
      () => renderScanReport({ data: { projectName: MARKUP }, ...opts() }).html,
    ],
    [
      'scan-failed',
      () => renderScanFailed({ data: { projectName: MARKUP, reason: MARKUP }, ...opts() }).html,
    ],
    [
      'critical-finding',
      () =>
        renderCriticalFinding({ data: { projectName: MARKUP, criticalCount: 1 }, ...opts() }).html,
    ],
    [
      'weekly-summary',
      () => renderWeeklySummary({ data: { ...WEEKLY_DATA, userName: MARKUP }, ...opts() }).html,
    ],
  ])('%s escapes untrusted values', (_name, render) => {
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img src=x');
  });

  test('a schedule name containing markup is escaped', () => {
    const { html } = renderScanFailed({
      data: { projectName: 'X', reason: 'boom', scheduleName: MARKUP },
      ...opts(),
    });
    expect(html).not.toContain('<img src=x');
  });
});

describe('renderTemplate', () => {
  test('covers every name it advertises', () => {
    expect([...TEMPLATE_NAMES]).toEqual([
      'scan-report',
      'scan-failed',
      'critical-finding',
      'weekly-summary',
    ]);
  });

  test('dispatches each template to its renderer', () => {
    expect(
      renderTemplate({ template: 'scan-report', data: SCAN_DATA }, opts()).subject,
    ).toBe('Assessment completed — API Analyzer');
    expect(
      renderTemplate(
        { template: 'scan-failed', data: { projectName: 'X', reason: 'boom' } },
        opts(),
      ).subject,
    ).toBe('Assessment failed — API Analyzer');
    expect(
      renderTemplate(
        { template: 'critical-finding', data: { projectName: 'X', criticalCount: 1 } },
        opts(),
      ).subject,
    ).toBe('Critical findings detected — API Analyzer');
    expect(
      renderTemplate({ template: 'weekly-summary', data: WEEKLY_DATA }, opts()).subject,
    ).toBe('Your weekly summary — API Analyzer');
  });

  test('passes the theme through to the renderer', () => {
    const dark = renderTemplate({ template: 'weekly-summary', data: WEEKLY_DATA }, opts('dark'));
    expect(dark.html).toContain(DARK.canvas);
  });
});

describe('safeUrl', () => {
  test.each([
    'https://example.test/report',
    'http://192.168.1.10:3000/reports/abc',
  ])('allows %s', (value) => {
    expect(safeUrl(value)).toBe(value);
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a url',
    '',
    undefined,
  ])('rejects %s', (value) => {
    expect(safeUrl(value as string | undefined)).toBeUndefined();
  });
});
