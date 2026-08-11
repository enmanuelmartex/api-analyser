import { IconRadar2 } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

export function ProjectLogoPlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.08]',
        className,
      )}
    >
      <span className="absolute inset-1.5 rounded-full border border-primary/15" />
      <IconRadar2 className="relative size-5 text-primary" stroke={1.7} />
      <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand-cyan" />
    </div>
  );
}
