import { appBrand, brandAssets, brandMark } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The product logo — the only place the official artwork is drawn.
 *
 * Every screen used to reach for the symbol its own way (an inline SVG here, a
 * `<span>API Analyser</span>` at a fourth font size there), so a brand revision
 * touched five files and the sizes never matched. Everything now goes through
 * this component, which owns three things no call site should have to know:
 *
 *  1. **Which official file to use.** The artwork ships as one file per surface
 *     (dark / light / two monochromes). `variant="auto"` — the default — renders
 *     the light and dark files and lets CSS pick, so the mark is correct the
 *     moment the theme class lands and never flashes the wrong colour.
 *
 *  2. **The brand's size rules.** Below 64 px the node network degrades into
 *     noise, so `type="symbol"` silently substitutes the compact artwork. That
 *     rule is the brand's, not a heuristic: see `branding/README.md`.
 *
 *  3. **The lockup's proportions.** The wordmark's size and its distance from
 *     the symbol are derived from measurements of the official horizontal
 *     lockup rather than eyeballed per screen.
 *
 * The artwork itself is never reconstructed, recoloured or restyled here — the
 * files in `public/brand/` are byte-identical copies of `branding/05-svg/`.
 */

export type BrandLogoType = 'symbol' | 'compact' | 'horizontal';

/**
 * Which official file to draw.
 *
 * `dark` and `light` name the SURFACE, matching the brand sheet: `dark` is the
 * artwork FOR a dark background. `auto` resolves against the active theme.
 */
export type BrandLogoVariant = 'auto' | 'dark' | 'light' | 'mono-white' | 'mono-black';

export type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Square box side in px.
 *
 * The visible mark is 0.88 × this tall and 0.74 × this wide, so `sm` and up
 * clear the brand's 32 px minimum. `xs` is below it and exists only for dense
 * chrome — a menu row, an avatar slot — where no logo would otherwise fit.
 */
const SIZE_PX: Record<BrandLogoSize, number> = { xs: 28, sm: 36, md: 44, lg: 64 };

export interface BrandLogoProps {
  /** `symbol` and `compact` draw the mark alone; `horizontal` adds the wordmark. */
  type?: BrandLogoType;
  variant?: BrandLogoVariant;
  /** A named step, or an explicit square box side in px. */
  size?: BrandLogoSize | number;
  className?: string;
  /** Extra classes for the wordmark, for surfaces with their own type scale. */
  wordmarkClassName?: string;
  /**
   * Reserves the brand's clear space (0.25 × the symbol width per side) as
   * padding. Off by default: most call sites sit inside a container that
   * already provides more than that, and doubling it looks like a mistake.
   */
  clearSpace?: boolean;
}

/**
 * Picks the official file for an artwork/variant pair.
 *
 * Monochrome wins over compactness. The brand ships no single-ink compact
 * file — both compact files keep the gradient core — so a caller who asked for
 * one ink gets the mono symbol at whatever size they asked for, rather than a
 * gradient they did not ask for.
 */
function fileFor(artwork: 'symbol' | 'compact', variant: Exclude<BrandLogoVariant, 'auto'>): string {
  if (variant === 'mono-white' || variant === 'mono-black') return brandAssets.symbol[variant];
  return brandAssets[artwork][variant];
}

export function BrandLogo({
  type = 'horizontal',
  variant = 'auto',
  size = 'sm',
  className,
  wordmarkClassName,
  clearSpace = false,
}: BrandLogoProps) {
  const px = typeof size === 'number' ? size : SIZE_PX[size];

  // The brand's own rule, applied once here rather than remembered per screen.
  const artwork: 'symbol' | 'compact' =
    type === 'compact' || px < brandMark.compactBelowPx ? 'compact' : 'symbol';

  // In `horizontal` the wordmark is real text beside the mark, so labelling the
  // image as well would make a screen reader announce the product name twice.
  const alt = type === 'horizontal' ? '' : appBrand.name;

  const pad = clearSpace ? px * brandMark.widthRatio * brandMark.clearSpaceRatio : undefined;

  const mark =
    variant === 'auto' ? (
      <>
        <Mark src={fileFor(artwork, 'light')} px={px} alt={alt} className="dark:hidden" />
        <Mark src={fileFor(artwork, 'dark')} px={px} alt={alt} className="hidden dark:block" />
      </>
    ) : (
      <Mark src={fileFor(artwork, variant)} px={px} alt={alt} />
    );

  if (type !== 'horizontal') {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center', className)}
        style={pad ? { padding: pad } : undefined}
      >
        {mark}
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center', className)}
      style={{ gap: px * brandMark.lockupGapRatio, ...(pad ? { padding: pad } : null) }}
    >
      {mark}
      <span
        className={cn('whitespace-nowrap font-semibold', wordmarkColor(variant), wordmarkClassName)}
        style={{
          fontSize: px * brandMark.wordmarkFontRatio,
          // The wordmark is never gradient-filled and never tracked wide; the
          // negative tracking matches the official lockup's letterfit.
          letterSpacing: '-0.021em',
          lineHeight: 1,
        }}
      >
        {appBrand.name}
      </span>
    </span>
  );
}

/** The wordmark takes the ink of the surface the chosen artwork is drawn for. */
function wordmarkColor(variant: BrandLogoVariant): string {
  switch (variant) {
    case 'dark':
    case 'mono-white':
      return 'text-white';
    case 'light':
    case 'mono-black':
      return 'text-brand-ink';
    default:
      return 'text-foreground';
  }
}

function Mark({
  src,
  px,
  alt,
  className,
}: {
  src: string;
  px: number;
  alt: string;
  className?: string;
}) {
  /*
   * A plain `<img>`, not `next/image`: the optimiser refuses SVG without
   * `dangerouslyAllowSVG`, so it would pass the file through untouched anyway,
   * while wrapping a mark whose box has to stay exactly square in its own
   * layout element. These are static, immutable, already-minimal files.
   */
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={px}
      height={px}
      draggable={false}
      className={cn('block shrink-0 select-none', className)}
      style={{ width: px, height: px }}
    />
  );
}
