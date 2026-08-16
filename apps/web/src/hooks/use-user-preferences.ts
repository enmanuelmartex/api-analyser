'use client';

import * as React from 'react';
import {
  DEFAULT_PREFERENCES,
  formatDateTime,
  formatDay,
  formatRelative,
  formatRelativeDay,
  formatTimeOfDay,
  getPreferences,
  subscribePreferences,
  type UserPreferences,
} from '@/lib/user-preferences';

/**
 * The React binding for the preferences store.
 *
 * Only components that must re-render the instant a preference changes need
 * this — chiefly the Settings pickers, which show a live sample of what they
 * are about to save. Everywhere else keeps calling the plain `formatDate` from
 * `lib/utils`, which reads the same store and therefore picks up the change on
 * its next render.
 */
export function useUserPreferences(): UserPreferences {
  return React.useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    // The server snapshot. Constant, and it has to be: returning a fresh object
    // here makes React loop. Nothing under `(dashboard)` is server-rendered, so
    // this is only ever the value React compares against during hydration.
    () => DEFAULT_PREFERENCES,
  );
}

/**
 * The formatters, already bound to the current preferences.
 *
 * Saves every caller from threading the preferences object through by hand, and
 * — because the identity changes with the preferences — makes them safe to use
 * inside `useMemo` dependency lists.
 */
export function useDateFormat() {
  const preferences = useUserPreferences();

  return React.useMemo(
    () => ({
      preferences,
      day: (value: string | number | Date) => formatDay(value, preferences),
      time: (value: string | number | Date) => formatTimeOfDay(value, preferences),
      dateTime: (value: string | number | Date) => formatDateTime(value, preferences),
      relative: (value: string | number | Date) => formatRelative(value, preferences),
      relativeDay: (value: string | number | Date) => formatRelativeDay(value, preferences),
    }),
    [preferences],
  );
}
