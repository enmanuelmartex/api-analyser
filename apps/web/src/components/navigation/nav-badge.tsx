'use client';

import { cn } from '@/lib/utils';
import { badgeAriaLabel, badgeLabel } from '@/lib/notification-badges';

/**
 * The unread count on a sidebar item.
 *
 * Colour comes from `primary`, through the same tinted treatment the Badge
 * component uses everywhere else — a soft `primary/10` ground with `primary`
 * text. Nothing here is a literal colour, so it follows the theme into dark mode
 * and follows the brand if the token changes.
 *
 * It is deliberately NOT severity-coloured. A red badge on Issues would read as
 * "these are critical" when it only means "these are new", and the product
 * already spends red, orange and yellow on severity. Those colours have to keep
 * meaning exactly one thing.
 */
export function NavBadge({ count, className }: { count: number; className?: string }) {
  // Nothing at zero — no empty pill, no "0". An item with nothing new should
  // look identical to one that has never had anything new. The rule, and the
  // 99+ cap, live in `badgeLabel` so they are testable without a DOM.
  const label = badgeLabel(count);
  if (label === null) return null;

  return (
    <span
      className={cn(
        /*
         * `h-5 min-w-5`, and both halves matter.
         *
         * Equal height and minimum width are what make a single digit a circle
         * rather than a pill: the box is 20px tall and cannot be narrower than
         * 20px, so "3" sits in a round badge instead of one shrink-wrapped to
         * the glyph. Two digits land at almost exactly 20px too (11px
         * tabular-nums plus `px-1`), so "12" stays round; only "99+" grows into
         * a lozenge, which is the right shape for it.
         *
         * These were `h-4.5 min-w-4.5`, which is Tailwind v4 syntax. This app is
         * on v3, whose default spacing scale stops half-steps at 3.5 — so both
         * classes compiled to nothing, the badge lost its height and its floor
         * width, and collapsed to whatever `px-1` and the digit gave it. Nothing
         * warns about an unknown utility; it simply is not in the stylesheet.
         */
        'pointer-events-none flex h-5 min-w-5 select-none items-center justify-center',
        'rounded-full px-1 text-[11px] font-medium leading-none tabular-nums',
        'bg-primary/10 text-primary',
        className,
      )}
      // The number alone is meaningless to a screen reader, which would read
      // "Scans 3" as a heading and a stray digit.
      aria-label={badgeAriaLabel(count)}
    >
      {label}
    </span>
  );
}

/**
 * The collapsed-rail form: a dot on the icon, no number.
 *
 * At 3rem wide there is no room for a legible count, and shrinking the text to
 * fit produces something nobody can read anyway. A dot answers the only question
 * the rail can usefully answer — is there anything new here — and the number is
 * one hover away in the tooltip.
 */
export function NavBadgeDot({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        'absolute right-1 top-1 size-2 rounded-full',
        'bg-primary',
        // A ring in the sidebar's own background keeps the dot legible where it
        // overlaps the icon, without drawing a border in an arbitrary colour.
        'ring-2 ring-sidebar',
      )}
      aria-hidden
    />
  );
}
