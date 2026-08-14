'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { authApi } from '@/lib/api';

/**
 * Mirrors the browser's theme choice onto the account.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * `next-themes` keeps the choice in `localStorage`, which is exactly right for
 * the thing it does: the browser is the only consumer, the value has to be
 * readable before first paint to avoid a flash, and a round trip would produce
 * one. Nothing about that is wrong.
 *
 * It stopped being sufficient when the transactional emails gained light and
 * dark variants. Those are rendered server-side — in the mail service, from a
 * queued job, often hours after the user last had a tab open — and there is no
 * browser in that path to read storage from. So the preference has to exist
 * somewhere the API can query, and this is what puts it there.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not make the server authoritative. The browser still decides what the
 * browser renders, `next-themes` still owns the switch, and nothing here reads
 * the stored value back to apply it — doing so would fight the storage-first
 * behaviour that prevents the flash, and would make a stale row override a
 * choice the user just made in this tab.
 *
 * This is a one-way mirror: browser → account, for the benefit of email only.
 */
export function ThemeSync() {
  const { theme } = useTheme();

  /**
   * The last value written, so a re-render does not repeat the request.
   *
   * `null` until the first effect runs, which is what makes the initial value
   * get written once — a user who has never changed their theme still needs
   * their default recorded, or every email they receive falls back to light.
   */
  const lastSent = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    // `theme` is undefined until next-themes has resolved against storage on
    // the client. Writing then would persist a value the user never chose.
    if (!theme) return;
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return;
    if (lastSent.current === theme || inFlight.current) return;

    inFlight.current = true;
    const sending = theme;

    authApi
      .updateMe({ theme: sending })
      .then(() => {
        lastSent.current = sending;
      })
      .catch(() => {
        /*
         * Deliberately silent.
         *
         * This is a background mirror of a cosmetic preference. A failed write
         * means the next email renders in the previously stored variant, which
         * is a wholly invisible degradation — and it fires on every page load,
         * including the ones where the session has just expired, so surfacing
         * it would produce a toast the user can neither act on nor understand.
         * `lastSent` is left unset so the next change retries.
         */
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [theme]);

  return null;
}
