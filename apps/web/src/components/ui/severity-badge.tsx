import { cn, severityToBg } from '@/lib/utils';
import type { Severity } from '@/types';

/*
 * This module also carried a `StatusBadge` and a `MethodBadge`, both written
 * against the raw Tailwind palette (`bg-emerald-500/10`, `text-violet-400`)
 * rather than the theme. Both were dead — every import resolved to the
 * tokenised copies in `components/security/` — so a second, off-system colour
 * vocabulary was surviving in the tree unused. They are gone; use
 * `components/security/finding-status-badge` and
 * `components/security/method-badge`.
 */

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
  size?: 'sm' | 'md';
}

export function SeverityBadge({ severity, className, size = 'md' }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold rounded-full border uppercase tracking-wider',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1',
        severityToBg(severity),
        className,
      )}
    >
      {severity}
    </span>
  );
}
