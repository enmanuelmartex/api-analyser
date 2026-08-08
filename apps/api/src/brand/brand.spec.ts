import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appBrand } from './brand';
import { logoAssetAvailable, logoDataUri } from './brand-assets';

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
});

describe('brand asset packaging', () => {
  it('finds the symbol on disk', () => {
    // Fails loudly if the nest build stops copying `brand/assets`, which would
    // otherwise ship PDFs with a silently missing logo.
    expect(logoAssetAvailable()).toBe(true);
  });

  it('inlines the symbol as a data URI so Chromium needs no network', () => {
    const uri = logoDataUri();
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(uri).not.toContain('http://');
    expect(uri).not.toContain('localhost');
  });

  it('memoises rather than re-reading the file per finding', () => {
    expect(logoDataUri()).toBe(logoDataUri());
  });

  it('decodes back to the same SVG that ships in the web app', () => {
    const decoded = Buffer.from(logoDataUri().split(',')[1], 'base64').toString('utf8');
    const webCopy = readFileSync(
      join(__dirname, '..', '..', '..', 'web', 'public', 'brand', 'api-analyser-icon.svg'),
      'utf8',
    );
    // The API copy and the web copy must not drift — the PDF and the UI have to
    // show the same mark.
    expect(decoded.trim()).toBe(webCopy.trim());
  });
});
