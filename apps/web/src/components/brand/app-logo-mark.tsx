/**
 * The API Analyser symbol, inlined as SVG.
 *
 * Inlined rather than loaded from `/brand/api-analyser-icon.svg` through an
 * `<img>`: `currentColor` only resolves when the SVG is part of the host
 * document, so an external reference would render the mark a fixed colour and
 * break on whichever theme it was not authored for. Inlining is what lets a
 * single definition serve dark and light.
 *
 * The standalone file still exists — the browser tab icon, Open Graph image and
 * the PDF renderer all need a real file — and `app-logo-mark.spec.ts` asserts
 * this component and that file describe the same geometry, so the copies cannot
 * drift silently.
 *
 * Geometry is fixed. Scale with `size`; do not restyle.
 */

/** Ring dash pattern: cut at the lower-left notch and at the beam aperture. */
export const RING_DASH_ARRAY = '210 21.8 211.5 63.7 14.5';
/** Stroked-circle radius; with stroke 34 this yields outer 100 / inner 66. */
export const RING_RADIUS = 83;
/** Centre dot radius. */
export const DOT_RADIUS = 26;

export function AppLogoMark({
  size = 28,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Accessible name. Omit when a visible wordmark already names the product. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient
          id="aa-beam"
          x1="148.35"
          y1="115.28"
          x2="216.2"
          y2="72.89"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#7C5CFF" />
          <stop offset="0.45" stopColor="#4D9DFF" />
          <stop offset="1" stopColor="#CFF0FF" />
        </linearGradient>
        <clipPath id="aa-disc">
          <circle cx="128" cy="128" r="100" />
        </clipPath>
      </defs>

      <circle
        cx="128"
        cy="128"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="34"
        strokeDasharray={RING_DASH_ARRAY}
      />
      <circle cx="128" cy="128" r={DOT_RADIUS} fill="currentColor" />

      <g clipPath="url(#aa-disc)">
        <path d="M148.78 116 L230.42 109.94 L189.13 43.87 L146.39 112.57 Z" fill="url(#aa-beam)" />
      </g>
    </svg>
  );
}
