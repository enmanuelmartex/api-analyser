import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appBrand } from './brand';
import { logoAssetAvailable, markDataUri } from './brand-assets';

/**
 * The brand contract.
 *
 * The product name has three spellings that look correct and are not
 * ("API Analyzer" with a z, "API analyser" lowercase, "APIAnalyser" closed up),
 * so the canonical form is pinned here rather than trusted to review. These
 * also guard the sync contract between the API's brand module and the web app's.
 */

describe('appBrand', () => {
  it('spells the product name canonically', () => {
    expect(appBrand.name).toBe('API Analyser');
  });

  it('uses the British "s", never a z', () => {
    expect(appBrand.name).not.toMatch(/Analyzer/i);
    expect(appBrand.description).not.toMatch(/Analyzer/i);
    expect(appBrand.tagline).not.toMatch(/Analyzer/i);
  });

  it('never carries the previous product name', () => {
    for (const value of Object.values(appBrand)) {
      expect(String(value)).not.toMatch(/IASA/i);
    }
  });

  it('exposes the public domain without a scheme', () => {
    expect(appBrand.domain).toBe('apianalyser.com');
    expect(appBrand.url).toBe('https://apianalyser.com');
  });

  it('produces a download slug that is filename-safe and unbranded-legacy-free', () => {
    expect(appBrand.fileSlug).toBe('api-analyser');
    expect(appBrand.fileSlug).toMatch(/^[a-z0-9-]+$/);
  });

  it('presents the new name in the scanner User-Agent', () => {
    expect(appBrand.scannerUserAgent).toContain('APIAnalyser');
    expect(appBrand.scannerUserAgent).not.toMatch(/IASA/i);
  });

  it('presents the new name in everything else a scanned target sees', () => {
    // These reach a stranger's access log during a scan, so the legacy name
    // must not travel with them either.
    expect(appBrand.scannerProbeHeader).toContain('APIAnalyser');
    expect(appBrand.scannerProbeHeader).not.toMatch(/IASA/i);
    expect(appBrand.scannerProbeField).not.toMatch(/IASA/i);
  });
});

describe('brand asset packaging', () => {
  it('finds both symbols on disk', () => {
    // Fails loudly if the nest build stops copying `brand/assets`, which would
    // otherwise ship PDFs with a silently missing logo.
    expect(logoAssetAvailable()).toBe(true);
  });

  it('inlines the symbol as a data URI so Chromium needs no network', () => {
    for (const surface of ['dark', 'light'] as const) {
      const uri = markDataUri(surface);
      expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
      expect(uri).not.toContain('http://');
      expect(uri).not.toContain('localhost');
    }
  });

  it('memoises rather than re-reading the file per finding', () => {
    expect(markDataUri('dark')).toBe(markDataUri('dark'));
  });

  it('draws a different symbol for each surface', () => {
    // The whole point of the pair: one file is white-on-transparent and the
    // other ink-on-transparent, because a data URI cannot inherit `currentColor`
    // and a single file rendered invisible on the report's dark cover.
    expect(markDataUri('dark')).not.toBe(markDataUri('light'));
  });

  it('ships the official artwork unmodified', () => {
    const decoded = (surface: 'dark' | 'light') =>
      Buffer.from(markDataUri(surface).split(',')[1], 'base64').toString('utf8');
    const official = (name: string) =>
      readFileSync(join(__dirname, '..', '..', '..', '..', 'branding', '05-svg', name), 'utf8');

    // The brand system at the repository root is the source of truth. A logo
    // that has been "tidied up" on its way into the API is a redrawn logo.
    expect(decoded('dark').trim()).toBe(official('mark-compact-white.svg').trim());
    expect(decoded('light').trim()).toBe(official('mark-compact-black.svg').trim());
  });

  it('uses the compact artwork, which is what the size rules require', () => {
    // Documents place the mark under a centimetre; the full node network is
    // only legible above 64 px. The compact files have no node network, so the
    // full mark's six node circles must not appear.
    const svg = Buffer.from(markDataUri('dark').split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('viewBox="0 0 1000 1000"');
    expect(svg.match(/<path/g)?.length).toBe(2);
  });
});
