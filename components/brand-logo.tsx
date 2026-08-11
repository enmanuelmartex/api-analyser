import { brand } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * The official mark, drawn to the brand's own rules.
 *
 * This is a trimmed copy of the product's `BrandLogo`: the landing branch shares
 * no code with the app, but it must not invent a second way of drawing the logo.
 * Two rules travel with it and are enforced here rather than remembered per call
 * site — both from `branding/README.md`:
 *
 *  1. **Below 64 px the node network becomes noise**, so the compact artwork is
 *     substituted automatically. A caller passes one number and gets the right
 *     file.
 *  2. **The lockup's proportions are measured, not eyeballed** — the wordmark's
 *     size and its distance from the symbol come from the official horizontal
 *     lockup in `branding/02-lockup/`.
 *
 * The artwork is never recoloured or reconstructed. `public/brand/*.svg` are
 * byte-identical copies of `branding/05-svg/`; the gradient lives only in the
 * mark's core and never touches the wordmark.
 */

/** Geometry measured off the 2048 px masters, from the product's `brand.ts`. */
const MARK = {
  compactBelowPx: 64,
  widthRatio: 0.7422,
  clearSpaceRatio: 0.25,
  wordmarkFontRatio: 0.4613,
  lockupGapRatio: 0.328,
} as const;

/**
 * This page has exactly one surface — Canvas — so only the dark-background
 * artwork is ever needed. The product ships four variants for the four surfaces
 * it renders on; here a second one would be dead weight.
 */
const ART = {
  symbol: '/brand/mark-for-dark-bg.svg',
  compact: '/brand/mark-compact-white.svg',
} as const;

export interface BrandLogoProps {
  /** `horizontal` adds the wordmark; the others draw the mark alone. */
  type?: 'symbol' | 'compact' | 'horizontal';
  /** Square box side in px. The visible mark is ~0.88 × this tall. */
  size?: number;
  className?: string;
  wordmarkClassName?: string;
  /** Reserves the brand's clear space (0.25 × symbol width per side). */
  clearSpace?: boolean;
}

export function BrandLogo({
  type = 'horizontal',
  size = 36,
  className,
  wordmarkClassName,
  clearSpace = false,
}: BrandLogoProps) {
  const src = type === 'compact' || size < MARK.compactBelowPx ? ART.compact : ART.symbol;

  // In `horizontal` the wordmark is real text beside the mark, so labelling the
  // image too would make a screen reader announce the product name twice.
  const alt = type === 'horizontal' ? '' : brand.name;
  const pad = clearSpace ? size * MARK.widthRatio * MARK.clearSpaceRatio : undefined;

  const mark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className="block shrink-0 select-none"
      style={{ width: size, height: size }}
    />
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
      style={{ gap: size * MARK.lockupGapRatio, ...(pad ? { padding: pad } : null) }}
    >
      {mark}
      <span
        className={cn('whitespace-nowrap font-semibold text-white', wordmarkClassName)}
        style={{
          fontSize: size * MARK.wordmarkFontRatio,
          // Never gradient-filled, never tracked wide: this negative tracking is
          // the official lockup's letterfit.
          letterSpacing: '-0.021em',
          lineHeight: 1,
        }}
      >
        {brand.name}
      </span>
    </span>
  );
}
