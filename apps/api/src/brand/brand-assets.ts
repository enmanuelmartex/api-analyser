import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Brand assets for server-rendered documents.
 *
 * The report HTML is printed by a headless Chromium that has no origin: a
 * relative `/brand/...` path resolves to nothing and an absolute
 * `http://localhost:3000/...` would tie PDF generation to the web app being up,
 * and would break outright in Docker where the two run in separate containers.
 *
 * The symbol is therefore read from disk once and inlined as a `data:` URI, so
 * a report renders identically in dev, in CI and in a container with no network.
 *
 * The files are resolved relative to THIS module rather than `process.cwd()`,
 * because the API is started from different working directories by `bun dev`,
 * `node dist/main.js` and the test runner.
 *
 * WHY THE COMPACT ARTWORK: a document places the mark at document scale — under
 * a centimetre — and the brand rules put the cut-off for the full node network
 * at 64 px. The full symbol printed that small turns its nodes into specks of
 * toner. The compact files keep the blades and the gradient core and drop the
 * network, which is exactly the case they exist for.
 *
 * WHY TWO FILES: the artwork is not tinted by CSS. `currentColor` does not
 * resolve through an `<img src="data:…">`, so the previous single file rendered
 * black-on-black on the report's dark cover — visible only by its gradient
 * core. A document surface picks the file drawn for it.
 */

/** Which surface the mark will sit on. */
export type BrandSurface = 'dark' | 'light';

const FILENAMES: Record<BrandSurface, string> = {
  dark: 'mark-compact-white.svg',
  light: 'mark-compact-black.svg',
};

function resolveAssetPath(filename: string): string {
  // `__dirname` is `src/brand` under ts-node/bun and `dist/brand` after nest
  // build; `assets/` is copied alongside by the build (see nest-cli.json).
  return join(__dirname, 'assets', filename);
}

const cache = new Map<BrandSurface, string>();

/**
 * The symbol as a `data:image/svg+xml;base64` URI, safe to drop into an `<img
 * src>` inside a document Chromium prints.
 *
 * Read once per surface and memoised — a report with fifty findings must not
 * hit the filesystem fifty times.
 *
 * Falls back to an empty string when the asset is missing rather than throwing:
 * a report without its logo is degraded, but a scan whose report generation
 * crashes over a missing image is worse. `brand.spec.ts` asserts both assets are
 * present, so a packaging mistake fails a test rather than silently shipping
 * unbranded PDFs.
 */
export function markDataUri(surface: BrandSurface): string {
  const cached = cache.get(surface);
  if (cached !== undefined) return cached;
  let uri: string;
  try {
    const svg = readFileSync(resolveAssetPath(FILENAMES[surface]), 'utf8');
    uri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  } catch {
    uri = '';
  }
  cache.set(surface, uri);
  return uri;
}

/** True when both symbol files were found on disk. Used by the packaging test. */
export function logoAssetAvailable(): boolean {
  return markDataUri('dark').length > 0 && markDataUri('light').length > 0;
}
