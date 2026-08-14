/**
 * The product's visible identity — the single source of truth for the web app.
 *
 * Every user-facing occurrence of the product name, domain, colour or logo path
 * must read from here. Before this module the string "API Analyser" was hardcoded in
 * fourteen components, so a rename meant hunting through JSX and inevitably
 * missing a toast or an aria-label.
 *
 * SYNC CONTRACT: `apps/api/src/brand/brand.ts` holds the same values for
 * server-rendered artifacts (PDF/HTML reports, Swagger).
 * The two apps have no shared workspace package, so the constants are
 * duplicated deliberately; change both together. `brand.spec.ts` in each app
 * pins the canonical spelling so a drift fails a test rather than shipping.
 *
 * NOTE ON "iasa": nothing. The identifier used to survive in infrastructure
 * contracts — the repository directory, the Postgres database name, seed
 * account emails, `IASA_*` CI secrets, the Docker image names. All of it was
 * renamed for v1.0, before the project had any deployment those contracts could
 * break. `localStorage` keys moved with it (`iasa_token` → `api_analyser_token`),
 * which signs out anyone holding a session from before the rename — once.
 */

export const appBrand = {
  /** Canonical product name. "API" uppercase, "Analyser" with an s. */
  name: 'API Analyser',
  shortName: 'API Analyser',
  domain: 'apianalyser.com',
  url: 'https://apianalyser.com',
  tagline: 'Automated API Security Assessment',
  description:
    'Automated API security assessment and vulnerability analysis. Scan REST APIs against the OWASP API Security Top 10.',
} as const;

/**
 * The official palette, verbatim from `branding/README.md`.
 *
 * These are the raw brand constants, not the UI's semantic colours. Components
 * should reach for the semantic tokens (`--primary`, `--border`, …) defined in
 * `globals.css`; this object exists for the few places that need the literal
 * brand value — the SVG gradients in charts, the PWA manifest, the `<meta
 * name="theme-color">` — where a CSS variable cannot be resolved.
 *
 * The same eight values are mirrored as HSL triplets in `globals.css` under
 * `--brand-*`, which is what the Tailwind `brand-*` colour scale reads.
 */
export const brandColors = {
  /** Ink — text on light surfaces. */
  ink: '#0A0A0B',
  /** Canvas — the dark surface. */
  canvas: '#08080A',
  white: '#FFFFFF',
  /** Violet — the start of the core gradient. */
  violet: '#6D4BFF',
  /** Indigo — the gradient's transition. */
  indigo: '#5566FF',
  /** Blue — primary accent, links, primary actions. */
  blue: '#2E8BF5',
  /** Cyan — nodes, CTA. */
  cyan: '#1FC2E8',
  /** Ice — highlight / hover. */
  ice: '#9BE4F7',
} as const;

/** The core gradient. Lives only in the mark's hexagonal core and in charts. */
export const brandGradient = `linear-gradient(135deg, ${brandColors.violet} 0%, ${brandColors.blue} 45%, ${brandColors.cyan} 100%)`;

/**
 * Logo files, copied verbatim from `branding/` at the repository root.
 *
 * They are shipped as static files rather than inlined as JSX because they are
 * 17–22 kB of path data each: inlining two of them (one per theme) into the
 * root layout would put ~40 kB of geometry in the JavaScript every route pays
 * for, instead of one immutable, cacheable request.
 *
 * The keys name the SURFACE the file is drawn for, matching the brand sheet:
 * `dark` is the version for a dark background (white blades), `light` the one
 * for a light background (ink blades).
 *
 * Do not edit these files. Re-copy them from `branding/05-svg/` if the brand
 * system is revised.
 */
export const brandAssets = {
  /** Full symbol: blades + node network + gradient core. Use at ≥ 64 px. */
  symbol: {
    dark: '/brand/mark-for-dark-bg.svg',
    light: '/brand/mark-for-light-bg.svg',
    'mono-white': '/brand/mark-mono-white.svg',
    'mono-black': '/brand/mark-mono-black.svg',
  },
  /**
   * Compact symbol: blades + core, no node network. Use below 64 px.
   *
   * There are deliberately no `mono-*` keys. The brand ships no single-ink
   * compact file — both compact files keep the gradient core — so a caller
   * asking for monochrome must be given the mono symbol instead. Handing them
   * the colour compact file would silently return a gradient to someone who
   * asked for one ink; `BrandLogo` resolves it that way.
   */
  compact: {
    dark: '/brand/mark-compact-white.svg',
    light: '/brand/mark-compact-black.svg',
  },
} as const;

/**
 * Geometry of the official symbol, measured off the 2048 px masters.
 *
 * The artwork sits inside a square canvas with transparent padding, so the
 * visible mark is smaller than the box you give it in CSS. These ratios are
 * what let `BrandLogo` honour the brand's size rules and reproduce the official
 * lockup's proportions with live type instead of a flattened raster.
 */
export const brandMark = {
  /** Visible mark height ÷ square box side. */
  heightRatio: 0.8804,
  /** Visible mark width ÷ square box side. */
  widthRatio: 0.7422,
  /**
   * Below this box size the node network degrades into noise, so the compact
   * symbol is substituted. From the brand rules: "Bajo 64 px usar la versión
   * compacta".
   */
  compactBelowPx: 64,
  /** Brand minimum on screen, measured on the visible mark. */
  minVisiblePx: 32,
  /** Clear space per side, as a multiple of the visible symbol width. */
  clearSpaceRatio: 0.25,
  /**
   * Lockup proportions, measured on `branding/02-lockup/`: the wordmark's cap
   * height is 0.381 × the symbol height and the two are optically centred, and
   * the gap between them is 0.615 × the symbol width. Expressed here against
   * the square box so a caller only ever passes one number.
   */
  wordmarkFontRatio: 0.4613,
  lockupGapRatio: 0.328,
} as const;

/** Browser tab title for a section, e.g. "Reports | API Analyser". */
export function pageTitle(section?: string): string {
  return section ? `${section} | ${appBrand.name}` : `${appBrand.name} — ${appBrand.tagline}`;
}
