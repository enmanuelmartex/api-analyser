'use client';

import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * The value the server renders with, and the one React hydrates against.
 *
 * `false` is safe rather than merely convenient: the desktop sidebar's root is
 * `hidden … md:block`, so below the breakpoint it contributes no layout at all.
 * Correcting to `true` right after hydration swaps an invisible subtree for the
 * (closed, equally invisible) mobile sheet, which moves nothing on screen.
 */
function getServerSnapshot() {
  return false;
}

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 *
 * This used to read `window.innerWidth` during render, which forced every
 * consumer to be client-only — the dashboard shell could not be server-rendered
 * at all, so its `h1` (the LCP element) only existed after hydration.
 * `useSyncExternalStore` gives React an explicit server snapshot instead, so the
 * shell renders on the server and the breakpoint is reconciled without a
 * hydration mismatch.
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
