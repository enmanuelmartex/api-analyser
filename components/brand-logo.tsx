import { brand } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * The official mark — the primary, full-colour artwork for a dark surface.
 *
 * One file, always: `branding/05-svg/mark-for-dark-bg.svg`, the "Primaria —
 * fondo oscuro / Color completo" tile from the brand sheet. This page has a
 * single surface, so the four-variant resolution the product needs would be
 * dead weight here.
 *
 * **Deliberate deviation from the brand rules.** `branding/README.md` says to
 * substitute the compact artwork below 64 px, because the six-node network
 * degrades into noise at small sizes. This page renders the full mark at 32–36
 * px anyway, on the product owner's instruction, so the logo in the navbar is
 * recognisably the same object as the one on the brand sheet rather than a
 * simplified cousin of it. The sizes below are the smallest at which the node
 * network still resolves on a 1× display — going smaller is what the rule was
 * written about.
 *
 * The artwork is never recoloured or reconstructed. `public/brand/` holds a
 * byte-identical copy; the gradient lives only in the mark's hexagonal core and
 * never touches the wordmark.
 */

/** Lockup geometry measured off the 2048 px masters, from the product's `brand.ts`. */
const MARK = {
  widthRatio: 0.7422,
  clearSpaceRatio: 0.25,
  wordmarkFontRatio: 0.4613,
  lockupGapRatio: 0.328,
} as const;

const ARTWORK = '/brand/mark-for-dark-bg.svg';

export interface BrandLogoProps {
  /** `horizontal` adds the wordmark; `symbol` draws the mark alone. */
  type?: 'symbol' | 'horizontal';
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
  // In `horizontal` the wordmark is real text beside the mark, so labelling the
  // image too would make a screen reader announce the product name twice.
  const alt = type === 'horizontal' ? '' : brand.name;
  const pad = clearSpace ? size * MARK.widthRatio * MARK.clearSpaceRatio : undefined;

  const mark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ARTWORK}
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
