'use client';

import * as React from 'react';

const DEFAULT_DELAY_MS = 250;

/**
 * Keeps a text input responsive while committing on a short delay.
 *
 * Now that list filters live in the URL, every commit is a navigation — so a
 * search box without this fires one `router.replace` per keystroke. Refs keep
 * the effect dependent on the draft alone, so a re-render mid-typing does not
 * restart the timer.
 */
export function useDebouncedField(
  committed: string,
  commit: (_next: string) => void,
  delayMs: number = DEFAULT_DELAY_MS,
) {
  const [draft, setDraft] = React.useState(committed);
  const commitRef = React.useRef(commit);
  const committedRef = React.useRef(committed);
  commitRef.current = commit;
  committedRef.current = committed;

  React.useEffect(() => setDraft(committed), [committed]);

  React.useEffect(() => {
    if (draft === committedRef.current) return;
    const id = setTimeout(() => commitRef.current(draft), delayMs);
    return () => clearTimeout(id);
  }, [draft, delayMs]);

  return { draft, setDraft };
}
