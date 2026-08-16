'use client';

import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    /**
     * Classes for the scrolling viewport itself.
     *
     * This is the only place a `max-h-*` cap belongs. The viewport is `h-full`,
     * and a percentage height against a root that has only a `max-height`
     * resolves to `auto` — so the viewport grows to its content, nothing ever
     * overflows it, and the root's `overflow-hidden` simply CLIPS the rest with
     * no scrollbar and no wheel response. Capping the viewport instead gives it
     * the definite bound it needs to scroll, while the root still shrinks to fit
     * a short list. A container with a definite height (`h-64`, or `flex-1` in a
     * fixed-height column) needs none of this and can cap the root as usual.
     */
    viewportClassName?: string;
  }
>(({ className, viewportClassName, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    {/*
      `[&>div]:!block` overrides the `display: table` Radix sets inline on the
      viewport's content wrapper. A table shrink-wraps to its widest child, so
      anything unbounded inside — a long comma-separated list, a right-aligned
      value in a two-column grid — widened the layout past the viewport instead
      of truncating, and the overflow was clipped with no horizontal scrollbar
      to reveal it. `min-width: 100%`, also inline, keeps the block full-width.
    */}
    <ScrollAreaPrimitive.Viewport
      className={cn('h-full w-full rounded-[inherit] [&>div]:!block', viewportClassName)}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-px',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-px',
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
