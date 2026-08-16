import type { ScanProfile } from '@/types';

/**
 * System profiles that duplicate an execution mode the picker already offers.
 *
 * "Full Scan" enumerates every check that ships with the platform, which is what
 * the "All enabled plugins" mode does — except the mode honours the checks the
 * operator actually left enabled, while the profile ignores that setting. Two
 * entries that look identical and quietly disagree is worse than one, so the
 * profile is hidden from the pickers. It still exists on the server, so
 * schedules already pointing at it keep working (see `selectedId` below).
 */
const REDUNDANT_SYSTEM_PROFILE_IDS = new Set(['full-scan']);

export interface GroupedScanProfiles {
  /** Built-in profiles, minus the ones an execution mode already covers. */
  system: ScanProfile[];
  /** Profiles this user saved themselves. */
  custom: ScanProfile[];
  /** Everything selectable, system first — for resolving the current choice. */
  selectable: ScanProfile[];
}

/**
 * Splits `GET /plugins/profiles` into the two groups the pickers render.
 *
 * The endpoint returns system and user profiles in one list, distinguished only
 * by `isSystem`. Consumers used to filter with `!profile.isSystem`, which threw
 * away every built-in profile — the run sheet offered "custom profile" and then
 * showed an empty state to anyone who had not built one, even though five
 * ready-made profiles were sitting right there in the response.
 *
 * `selectedId` keeps an otherwise-hidden profile in the list when it is the
 * current selection, so editing a schedule saved against "Full Scan" does not
 * show a blank field.
 */
export function groupScanProfiles(
  profiles: ScanProfile[] | undefined,
  selectedId?: string,
): GroupedScanProfiles {
  const all = profiles ?? [];

  const system = all.filter(
    (profile) =>
      profile.isSystem &&
      (!REDUNDANT_SYSTEM_PROFILE_IDS.has(profile.id) || profile.id === selectedId),
  );
  const custom = all.filter((profile) => !profile.isSystem);

  return { system, custom, selectable: [...system, ...custom] };
}
