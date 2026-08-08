'use client';

import { useRouter } from 'next/navigation';
import { IconMoon, IconPlus, IconSun } from '@tabler/icons-react';
import { useTheme } from 'next-themes';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { NAV_MAIN, NAV_COLLAPSIBLE } from '@/components/navigation/nav-data';

/**
 * The palette body, split out from `command-menu.tsx` so that `cmdk` and the
 * command primitives load as their own chunk.
 *
 * Every dashboard route renders the provider, but the palette itself is only
 * reachable through Cmd/Ctrl+K — so shipping it in the route entry chunk made
 * every page wait on code most visits never use. State stays in the provider and
 * arrives as props; this component deliberately does not read the context, which
 * would reintroduce the import cycle the split exists to avoid.
 */
export function CommandMenu({ open, setOpen }: { open: boolean; setOpen: (_next: boolean) => void }) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();

  function runCommand(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => router.push('/projects/new'))}>
            <IconPlus className="h-4 w-4" />
            New Project
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}>
            {resolvedTheme === 'dark' ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
            Toggle theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {NAV_MAIN.map((item) => (
            <CommandItem key={item.url} onSelect={() => runCommand(() => router.push(item.url))}>
              <item.icon className="h-4 w-4" />
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {NAV_COLLAPSIBLE.map((group) => (
          <CommandGroup key={group.title} heading={group.title}>
            {group.items.map((item) => (
              <CommandItem key={item.url} onSelect={() => runCommand(() => router.push(item.url))}>
                <item.icon className="h-4 w-4" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
