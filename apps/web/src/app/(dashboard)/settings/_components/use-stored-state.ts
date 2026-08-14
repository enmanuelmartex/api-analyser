'use client';

import * as React from 'react';

/**
 * State backed by `localStorage`.
 *
 * Used for view preferences that belong to the browser rather than the account
 * — which columns of the log table are visible, how many rows per page. These
 * are not settings: they are not worth a round trip, they are not audited, and
 * they should differ between the laptop and the wall display looking at the
 * same instance.
 *
 * The initial render always returns `fallback`, and the stored value is applied
 * in an effect. Reading `localStorage` during render would produce different
 * markup on the server and the client, which React resolves by throwing away
 * the server's — a hydration error for the sake of one frame.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [value, setValue] = React.useState<T>(fallback);
  const [hydrated, setHydrated] = React.useState(false);

  /*
   * Held in a ref so the read effect can depend on `key` alone. Callers pass a
   * module-level type guard, but depending on the function identity would
   * re-read storage on every render for anyone who passes an inline one.
   */
  const validateRef = React.useRef(validate);
  validateRef.current = validate;

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        const guard = validateRef.current;
        if (!guard || guard(parsed)) setValue(parsed as T);
      }
    } catch {
      // A corrupt or unreadable entry falls back to the default rather than
      // taking the screen down. Private browsing can also throw on read.
    }
    setHydrated(true);
  }, [key]);

  React.useEffect(() => {
    if (!hydrated) return; // Never write the fallback over a stored value.
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded, or storage disabled. A preference that cannot be
      // remembered is not worth an error toast.
    }
  }, [key, value, hydrated]);

  return [value, setValue, hydrated];
}
