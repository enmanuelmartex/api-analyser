import { cn } from '@/lib/utils';

/**
 * The page's rhythm, in one place.
 *
 * Every section below the hero shares the same three things: a hairline that
 * catches a little light at the top edge (which is what separates two sections
 * painted the same colour), a container width, and a heading scale. Repeating
 * that per section is how the spacing drifts.
 */

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // The vertical rhythm steps with the viewport. 96px of padding above and
    // below reads as generous on a desktop and as dead space on a phone, where
    // it was adding roughly 1,500px of nothing to a page already 16 screens long.
    <section id={id} className={cn('relative bg-brand-canvas py-16 sm:py-24 lg:py-32', className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 30%, rgba(255,255,255,0.07) 70%, transparent)',
        }}
      />
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6">{children}</div>
    </section>
  );
}

const DOT_TONES = {
  violet: 'bg-brand-violet',
  blue: 'bg-brand-blue',
  cyan: 'bg-brand-cyan',
  amber: 'bg-severity-medium',
} as const;

export function SectionLabel({
  children,
  tone = 'blue',
}: {
  children: React.ReactNode;
  tone?: keyof typeof DOT_TONES;
}) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-zinc-400">
      <span className={cn('h-2 w-2 rounded-full', DOT_TONES[tone])} />
      {children}
    </p>
  );
}

export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl',
        className,
      )}
    >
      {children}
    </h2>
  );
}
