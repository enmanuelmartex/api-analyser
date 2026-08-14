/**
 * Renders the email logo from the canonical brand vectors.
 *
 * Run by hand, not at build time: the output is committed, because a Vercel
 * build should not depend on a sibling checkout of the monorepo, and the mark
 * changes roughly never.
 *
 *   bun run scripts/build-email-logo.mjs
 *
 * Why PNG and not the SVG itself: Gmail, Outlook and Yahoo all refuse inline or
 * linked SVG. Why 120px for a 40px slot: 3x, so the mark stays crisp on a
 * retina phone, at a file size (~5 KB) that costs nothing to fetch.
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const brandRoot = resolve(here, '../../api-analyser/branding/05-svg');
const outDir = join(here, '../public/brand');

/** Display size is 40px; 3x keeps it sharp on a retina display. */
const SIZE = 120;

const VARIANTS = [
  { source: 'mark-for-light-bg.svg', out: 'mark-light.png' },
  { source: 'mark-for-dark-bg.svg', out: 'mark-dark.png' },
];

for (const { source, out } of VARIANTS) {
  const svg = await readFile(join(brandRoot, source));
  await sharp(svg, { density: 600 })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(outDir, out));
  console.log(`wrote public/brand/${out}`);
}
