/**
 * The landing is a single static page, so it is built to run either way:
 *
 *   bun run build          → a normal Next server build (Vercel, a container)
 *   bun run build:static   → `out/`, a folder of files any static host serves
 *
 * The export target is opt-in rather than the default because `next dev` and
 * `output: 'export'` disagree about a few behaviours, and the dev server is what
 * anyone editing this page uses all day.
 */
const staticExport = process.env.NEXT_STATIC_EXPORT === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(staticExport ? { output: 'export' } : {}),
  // Every image on this page is either an SVG the optimiser refuses to touch or
  // a brand PNG already exported at its final size, so the optimiser has nothing
  // to do — and it is unavailable in a static export anyway.
  images: { unoptimized: true },
};

export default nextConfig;
