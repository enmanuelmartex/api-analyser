'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const loadCommandMenu = () => import('./command-menu-dialog');

const CommandMenu = dynamic(() => loadCommandMenu().then((m) => m.CommandMenu), { ssr: false });

interface CommandMenuContextValue {
  open: boolean;
  setOpen: (_next: boolean) => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu() {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error('useCommandMenu must be used within CommandMenuProvider');
  return ctx;
}

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // The palette chunk is only mounted after the first open. Tracking that
  // separately from `open` keeps the dialog mounted afterwards, so closing it
  // does not unmount `cmdk` and re-trigger the loading state on the next Cmd+K.
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  // Warm the chunk once the browser is idle, so the first Cmd+K opens instantly
  // even though the code is no longer part of the route's entry bundle. Falls
  // back to a timeout on Safari, which still lacks requestIdleCallback.
  useEffect(() => {
    const warm = () => void loadCommandMenu();
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, []);

  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      {everOpened && <CommandMenu open={open} setOpen={setOpen} />}
    </CommandMenuContext.Provider>
  );
}
