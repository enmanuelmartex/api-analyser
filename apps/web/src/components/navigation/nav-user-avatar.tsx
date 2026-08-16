'use client';

import { avatarColor, UserAvatar } from '@/components/shared/user-avatar';
import { badgeLabel } from '@/lib/notification-badges';
import { cn } from '@/lib/utils';

/**
 * The account avatar in the sidebar footer: the user's initials, a slowly
 * rotating ring, and the unread count.
 *
 * Presentational on purpose. `unreadCount` is passed in rather than read here,
 * because the row this sits in needs the same number for its `aria-label` — the
 * badge itself is `aria-hidden`, since a bare digit announced after "Open user
 * menu" is noise. One owner of the count, one accessible name.
 *
 * ── The three layers, and why they are siblings
 *
 * The ring rotates; the avatar and the badge must not. That rules out drawing
 * either of them inside the rotating element, and it rules out the badge living
 * inside `<Avatar>` — whose root is `overflow-hidden` (it has to be, to clip a
 * social provider's image to the circle), so a badge nested there would simply
 * be cut off at the avatar's edge. All three are children of one `relative`
 * wrapper instead, in paint order: ring, avatar, badge.
 */
export function NavUserAvatar({
  name,
  color,
  src,
  unreadCount,
  className,
}: {
  name: string | null | undefined;
  color?: string | null;
  src?: string | null;
  /** Total unread notifications, of every type. Zero renders no badge. */
  unreadCount: number;
  className?: string;
}) {
  // `badgeLabel` is the same rule the sidebar badges and the header bell use:
  // null below one, `99+` above ninety-nine. Sharing it is what stops the two
  // counters in the chrome from disagreeing about what "many" looks like.
  const label = badgeLabel(unreadCount);

  /*
   * The ring takes the account's own avatar colour, two shades brighter.
   *
   * Read through the same `avatarColor` resolver the fill uses, so there is one
   * palette and an unknown key degrades to the default here exactly as it does
   * there. The pair of custom properties lands on this wrapper and the gradient
   * inside inherits them — which is also what makes the ring follow a colour
   * change the moment the settings screen writes it back to the `['me']` cache.
   */
  const ring = avatarColor(color).ring;

  return (
    <div className={cn('group/avatar relative shrink-0', ring, className)}>
      {/*
        The ring.

        `-inset-1` puts it 4px outside the avatar, of which the avatar's own
        2px `ring-sidebar` eats half — so 2px of gradient shows, and the blur
        turns that into a glow rather than a hard band. Kept at exactly 40px
        total because that is the width of the collapsed rail's button; any
        larger and the halo is clipped by the sidebar's own `overflow-hidden`.

        `pointer-events-none` because this sits inside the dropdown trigger:
        the ring must never be what a click lands on.
      */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -inset-1 rounded-full bg-avatar-ring',
          // Turns and breathes. The opacity belongs to the pulse keyframes —
          // see the comment on them for why nothing else may set it.
          'animate-avatar-ring',
          /*
           * The resting values the animation plays around, and the ones that
           * survive on their own under `prefers-reduced-motion`: that rule
           * cuts every animation to a single 0.01ms run, after which the
           * element falls back to its own declarations. Without `opacity-50`
           * here a reduced-motion user would get a solid, full-strength ring.
           */
          'opacity-50 blur-[2px] saturate-100',
          'transition-[filter] duration-500 ease-out',
          /*
           * Hover intensifies the glow through `filter` alone — a softer,
           * more saturated bloom — because the pulse owns opacity. Both halves
           * are set at rest too, so the two filter lists have the same shape
           * and the browser interpolates between them instead of snapping.
           *
           * It answers to the avatar or to anywhere on the row, since the whole
           * row is the button. `group/menu-item` is declared by
           * `SidebarMenuItem`; where this renders outside one, that variant
           * simply never matches.
           */
          'group-hover/avatar:blur-[4px] group-hover/avatar:saturate-150',
          'group-hover/menu-item:blur-[4px] group-hover/menu-item:saturate-150',
        )}
      />

      <UserAvatar
        name={name}
        color={color}
        src={src}
        className={cn(
          'relative size-8',
          /*
           * Opaque, and load-bearing: the default fallback fill is a 10% tint,
           * so without a solid ground underneath it the ring would rotate
           * visibly *through* the initials. `bg-sidebar` is what was behind the
           * avatar before this change, so the fill composites exactly as it
           * always did.
           */
          'bg-sidebar',
          // A 2px gap in the sidebar's own colour, so the halo reads as a ring
          // around the avatar rather than a glow leaking out of it.
          'ring-2 ring-sidebar',
          'transition-transform duration-500 ease-out',
          'group-hover/avatar:scale-95 group-hover/menu-item:scale-95',
        )}
      />

      {label !== null && (
        <span
          // The count is already in the trigger's accessible name; announcing
          // it twice is worse than not announcing it here at all.
          aria-hidden
          className={cn(
            // Above the ring, and outside the avatar's clip. Equal height and
            // floor width keep one digit round; `px-1` lets "12" and "99+" grow
            // leftwards from the pinned right edge, so the badge never widens
            // towards the sidebar's border.
            'pointer-events-none absolute -right-1 -top-1 z-20 flex',
            'h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1',
            'text-[10px] font-semibold leading-none tabular-nums',
            // Primary, not destructive. An unread notification is news, not an
            // alarm — and red in this product means severity, which has to keep
            // meaning exactly one thing.
            'bg-primary text-primary-foreground',
            // A ring rather than a border: same visual separation from the glow
            // behind it, without stealing 4px from an 18px box.
            'ring-2 ring-sidebar',
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
