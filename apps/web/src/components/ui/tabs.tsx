'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Two presentations, because a page can carry two levels of tabs.
 *
 *   underline — the default. A rule under the active tab, sitting on a border
 *               that spans the width. Reads as primary navigation.
 *   segmented — a pill group on a recessed track. Reads as a control that
 *               switches the view *within* a section.
 *
 * Stacking two underline strips makes the second look like a second page-level
 * nav; the variant is what keeps Audit logs' sub-views subordinate to the
 * Settings strip above them.
 */
type TabsVariant = 'underline' | 'segmented';

const TabsVariantContext = React.createContext<TabsVariant>('underline');

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'segmented', ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-start text-muted-foreground',
        variant === 'underline' && 'h-9 gap-1 border-b border-border',
        variant === 'segmented' &&
          'h-9 max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors',
        'hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'underline' &&
          '-mb-px rounded-t-sm border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-primary data-[state=active]:text-foreground',
        variant === 'segmented' &&
          'rounded-md px-2.5 py-1 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
