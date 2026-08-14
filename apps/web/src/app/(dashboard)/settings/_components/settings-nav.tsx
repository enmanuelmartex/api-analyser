'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SettingsTab<Id extends string = string> {
  id: Id;
  label: string;
  icon: React.ElementType;
  group: 'account' | 'platform';
  adminOnly?: boolean;
}

/**
 * The Settings section switcher.
 *
 * Two presentations of one list, chosen by viewport rather than by hiding
 * anything:
 *
 *   ≥ sm — a horizontal rail. Eleven entries do not fit on a laptop, so it
 *          scrolls, and the edges fade to say so. The active entry is scrolled
 *          into view on mount, which is what makes a deep link to `?tab=about`
 *          land somewhere legible instead of at "General" with the real
 *          selection off-screen.
 *   < sm — a select. Eleven scrolling chips on a phone is a worse control than
 *          a native picker, and the group labels survive the transition.
 *
 * The active state is an accent underline plus a very light wash. The underline
 * carries the meaning; the wash only widens the hit target's read at a glance.
 * Colour is not the sole signal — the label also goes to full foreground weight
 * — so the selection survives a monochrome display.
 */
export function SettingsNavigation<Id extends string>({
  tabs,
  active,
  onSelect,
  className,
}: {
  tabs: SettingsTab<Id>[];
  active: Id;
  // eslint-disable-next-line no-unused-vars
  onSelect: (id: Id) => void;
  className?: string;
}) {
  const accountTabs = tabs.filter((tab) => tab.group === 'account');
  const platformTabs = tabs.filter((tab) => tab.group === 'platform');
  const activeTab = tabs.find((tab) => tab.id === active);

  return (
    <div className={cn('min-w-0', className)}>
      {/* ── Narrow: one picker ──────────────────────────────────────────── */}
      <div className="sm:hidden">
        <Select value={active} onValueChange={(value) => onSelect(value as Id)}>
          <SelectTrigger className="w-full" aria-label="Settings section">
            <SelectValue>
              <span className="flex items-center gap-2">
                {activeTab && <activeTab.icon className="h-4 w-4 text-muted-foreground" />}
                {activeTab?.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Account</SelectLabel>
              {accountTabs.map((tab) => (
                <SelectItem key={tab.id} value={tab.id}>
                  <span className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4 text-muted-foreground" />
                    {tab.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
            {platformTabs.length > 0 && (
              <SelectGroup>
                <SelectLabel>Platform</SelectLabel>
                {platformTabs.map((tab) => (
                  <SelectItem key={tab.id} value={tab.id}>
                    <span className="flex items-center gap-2">
                      <tab.icon className="h-4 w-4 text-muted-foreground" />
                      {tab.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* ── Wide: the rail ──────────────────────────────────────────────── */}
      <div className="hidden sm:block">
        <ScrollRail>
          <div
            role="tablist"
            aria-label="Settings sections"
            className="flex items-end gap-0.5 border-b border-border"
          >
            {accountTabs.map((tab) => (
              <NavItem
                key={tab.id}
                tab={tab}
                selected={tab.id === active}
                onSelect={() => onSelect(tab.id)}
              />
            ))}

            {platformTabs.length > 0 && (
              <span
                className="mx-2 mb-2.5 h-4 w-px flex-shrink-0 bg-border"
                aria-hidden="true"
              />
            )}

            {platformTabs.map((tab) => (
              <NavItem
                key={tab.id}
                tab={tab}
                selected={tab.id === active}
                onSelect={() => onSelect(tab.id)}
              />
            ))}
          </div>
        </ScrollRail>
      </div>
    </div>
  );
}

function NavItem({
  tab,
  selected,
  onSelect,
}: {
  tab: SettingsTab;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);

  // Only when it is off-screen: an unconditional `scrollIntoView` on a rail
  // that already fits scrolls the whole page on some browsers.
  React.useEffect(() => {
    if (!selected) return;
    const node = ref.current;
    const rail = node?.parentElement?.parentElement;
    if (!node || !rail) return;
    const nodeBox = node.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    if (nodeBox.left < railBox.left || nodeBox.right > railBox.right) {
      node.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'relative flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/[0.06] font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <tab.icon
        className={cn('h-4 w-4 flex-shrink-0', selected ? 'text-primary' : 'opacity-70')}
        aria-hidden="true"
      />
      {tab.label}
    </button>
  );
}

/**
 * A horizontally scrollable strip that fades at whichever edge has more to
 * show.
 *
 * The fades are driven by scroll position rather than always painted: a static
 * gradient over a rail that fits looks like a rendering fault, and one that
 * never disappears at the end of the scroll suggests content that is not there.
 */
function ScrollRail({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const { scrollLeft, scrollWidth, clientWidth } = node;
      setEdges({
        start: scrollLeft > 1,
        end: scrollLeft + clientWidth < scrollWidth - 1,
      });
    };

    measure();
    node.addEventListener('scroll', measure, { passive: true });

    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => {
      node.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity',
          edges.start ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity',
          edges.end ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
