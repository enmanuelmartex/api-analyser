/**
 * The values `User.avatarColor`, `User.dateFormat` and `User.timeFormat` accept.
 *
 * These are presentation choices — what the browser does with them is defined
 * in `apps/web/src/lib/user-preferences.ts` (formats) and
 * `apps/web/src/components/shared/user-avatar.tsx` (colours). The API keeps its
 * own copy of the *keys* for one reason: to reject a value nothing can render.
 * Without it the column is a free-text field, and a typo saved once is a
 * preference that silently never applies.
 *
 * Deliberately keys, not rendered values. The API stores `iso`, never
 * `2026-08-14`, and `violet`, never `#8B5CF6` — so the web app can restyle the
 * palette for dark mode, or change what `iso` means, without a data migration
 * and without the server needing to know anything about CSS.
 *
 * Adding an entry here and in the web counterpart is the whole cost of a new
 * option. Removing one is safe: an account still holding the old key falls back
 * to the default rather than breaking, which is why the columns are strings and
 * not database enums.
 */

/**
 * Avatar background colours.
 *
 * `default` is the existing look — the primary tint every account renders with
 * today — and is what a null column resolves to, so nothing changes appearance
 * until its owner deliberately picks something else.
 */
export const AVATAR_COLOR_KEYS = [
  'default',
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const;

export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number];

/**
 * Date presentation.
 *
 * `medium` is the product default and reproduces exactly what every timestamp
 * in the app renders as today (`Aug 14, 2026`); `auto` defers to whatever the
 * browser's own locale produces.
 */
export const DATE_FORMAT_KEYS = ['auto', 'medium', 'long', 'iso', 'dmy', 'mdy'] as const;

export type DateFormatKey = (typeof DATE_FORMAT_KEYS)[number];

/** Clock presentation. `12h` is the product default, matching today's output. */
export const TIME_FORMAT_KEYS = ['auto', '12h', '24h'] as const;

export type TimeFormatKey = (typeof TIME_FORMAT_KEYS)[number];

/**
 * Light/dark preference.
 *
 * The same three values `next-themes` uses in the browser, stored verbatim so
 * the column and the client agree without a translation step. `system` is kept
 * rather than resolved at write time: what the OS reports can change after the
 * user chooses, and collapsing it early would freeze a preference that is
 * meant to follow.
 */
export const THEME_KEYS = ['system', 'light', 'dark'] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

/** The two variants anything rendered server-side can actually produce. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * The theme to render an email in, for a user who may not have chosen one.
 *
 * `system` resolves to light rather than being honoured, because there is no
 * system to consult: the renderer is a serverless function, and the OS setting
 * lives on a device it has never seen. Light is also the safer of the two to
 * guess — a light email force-inverted by a client is merely dark, while a dark
 * email force-inverted is white text on white.
 *
 * Null, an unknown value and `system` all land in the same place, which is what
 * makes this total over whatever is actually in the column, including a value
 * written by an older version of the app.
 */
export function resolveEmailTheme(theme: string | null | undefined): ResolvedTheme {
  return theme === 'dark' ? 'dark' : 'light';
}
