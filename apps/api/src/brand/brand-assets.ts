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
 * The file is resolved relative to THIS module rather than `process.cwd()`,
 * because the API is started from different working directories by `bun dev`,
 * `node dist/main.js` and the test runner.
 */

/** Where the SVG lives relative to this file, in source and in `dist`. */
const ICON_FILENAME = 'api-analyser-icon.svg';

function resolveIconPath(): string {
  // `__dirname` is `src/brand` under ts-node/bun and `dist/brand` after nest
  // build; `assets/` is copied alongside by the build (see nest-cli.json).
  return join(__dirname, 'assets', ICON_FILENAME);
}

let cachedDataUri: string | null = null;

/**
 * The symbol as a `data:image/svg+xml;base64` URI, safe to drop into an `<img
 * src>` inside a document Chromium prints.
 *
 * Read once and memoised — a report with fifty findings must not hit the
 * filesystem fifty times.
 *
 * Falls back to an empty string when the asset is missing rather than throwing:
 * a report without its logo is degraded, but a scan whose report generation
 * crashes over a missing image is worse. `brand-assets.spec.ts` asserts the
 * asset is present, so a packaging mistake fails a test rather than silently
 * shipping unbranded PDFs.
 */
export function logoDataUri(): string {
  if (cachedDataUri !== null) return cachedDataUri;
  try {
    const svg = readFileSync(resolveIconPath(), 'utf8');
    cachedDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  } catch {
    cachedDataUri = '';
  }
  return cachedDataUri;
}

/** True when the symbol was found on disk. Used by the packaging test. */
export function logoAssetAvailable(): boolean {
  return logoDataUri().length > 0;
}
