'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Icon } from '@tabler/icons-react';

export interface SectionTab {
  id: string;
  label: string;
  href: string;
  icon?: Icon;
  /** Optional trailing count, e.g. the number of rows behind the tab. */
  count?: number;
}

/**
 * The one in-page tab strip used across the product.
 *
 * Screens that own several views — Settings, Security Checks, Project detail,
 * Scan detail — previously each invented their own switcher, or pushed their
 * sections into the global sidebar. Both are wrong for the same reason: a tab
 * is navigation *within* a destination, and duplicating it in the sidebar gives
 * one destination two active states.
 *
 * Renders real links so a tab can be opened in a new tab, copied, and reached
 * without JavaScript. Callers that keep tab state in a query parameter pass the
 * full href and set `isActive` themselves.
 */
export function SectionTabs({
  tabs,
  activeId,
  className,
  ariaLabel = 'Sections',
}: {
  tabs: SectionTab[];
  activeId: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon && <tab.icon className="h-4 w-4" aria-hidden="true" />}
            {tab.label}
            {tab.count != null && (
              <span
                className={cn(
                  'ml-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                  active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
