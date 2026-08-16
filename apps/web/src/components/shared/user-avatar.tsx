'use client';

import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * The one place a user is drawn as initials on a colour.
 *
 * The product stores no avatar images and is not going to: an image upload
 * means object storage, a size limit, a content-type check, an EXIF strip and a
 * moderation question, all to answer "which row is mine?" — which two initials
 * and a colour answer just as well. So the only thing an account chooses about
 * its avatar is the background, and this component is where that choice lands.
 *
 * `avatar` (a URL) is still honoured when present, because Better Auth writes
 * its `image` field into that column for accounts created through a social
 * provider. Nothing in this product ever sets it; it is read-only as far as we
 * are concerned, and the colour is what shows for every local account.
 *
 * ── Why the palette lives in a component file
 *
 * Tailwind scans `src/components` and `src/app` for class names as plain text.
 * A palette in `src/lib` would be outside the content globs, and every colour
 * here would be silently dropped from the stylesheet in a production build —
 * the picker would render twelve identical grey swatches and nobody would know
 * why. Keeping the table beside its only consumer makes that impossible.
 */

export type AvatarColorKey =
  | 'default'
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink';

interface AvatarColor {
  key: AvatarColorKey;
  label: string;
  /** Background and text for the avatar itself. */
  fill: string;
  /** A solid chip for the picker, where the tint would be too faint to compare. */
  swatch: string;
  /**
   * The two stops of the animated ring in the sidebar footer, as custom
   * properties the `bg-avatar-ring` gradient reads.
   *
   * Two shades up from the `fill` tint on purpose: the avatar is a 15% wash, so
   * a ring in the same value would be a slightly brighter smudge around a faint
   * disc. The 500 carries the identity and the 400 is the shimmer that sweeps
   * through it, which is what stops a rotating single colour from looking like
   * a static circle.
   *
   * Written as arbitrary properties rather than as a `ringFrom`/`ringTo` pair of
   * raw values for the same reason the rest of this table is: Tailwind reads
   * these files as text, and only a complete class name here ends up in the
   * stylesheet.
   */
  ring: string;
}

/**
 * Twelve colours, each a tint rather than a solid fill.
 *
 * A saturated circle with white initials would be the loudest thing in a
 * sidebar built almost entirely from neutrals, and there is one on every issue
 * row. The tint carries the identity at a glance without competing with
 * severity — which is the only place this product spends real colour.
 *
 * Every entry pairs a light-mode and a dark-mode foreground explicitly. The
 * same tint sits on a white card and on a near-black one; a single text colour
 * fails one of them, and an avatar you cannot read is worse than no avatar.
 *
 * `default` is the existing look, and is what an account that has never chosen
 * renders as — so this feature changes nothing until somebody uses it. The keys
 * are mirrored in `apps/api/src/modules/auth/display-preferences.ts`, which is
 * what stops an unrenderable value from being saved.
 */
export const AVATAR_COLORS: AvatarColor[] = [
  {
    key: 'default',
    label: 'Default',
    fill: 'bg-primary/10 text-primary',
    swatch: 'bg-primary',
    // The only entry whose ring is theme tokens rather than palette values: its
    // fill is `primary`, so its ring has to follow the brand into dark mode the
    // same way the fill does.
    ring: '[--avatar-ring-a:hsl(var(--primary))] [--avatar-ring-b:hsl(var(--brand-cyan))]',
  },
  {
    key: 'slate',
    label: 'Slate',
    fill: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
    swatch: 'bg-slate-500',
    ring: '[--avatar-ring-a:theme(colors.slate.500)] [--avatar-ring-b:theme(colors.slate.400)]',
  },
  {
    key: 'red',
    label: 'Red',
    fill: 'bg-red-500/15 text-red-700 dark:text-red-300',
    swatch: 'bg-red-500',
    ring: '[--avatar-ring-a:theme(colors.red.500)] [--avatar-ring-b:theme(colors.red.400)]',
  },
  {
    key: 'orange',
    label: 'Orange',
    fill: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    swatch: 'bg-orange-500',
    ring: '[--avatar-ring-a:theme(colors.orange.500)] [--avatar-ring-b:theme(colors.orange.400)]',
  },
  {
    key: 'amber',
    label: 'Amber',
    fill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    swatch: 'bg-amber-500',
    ring: '[--avatar-ring-a:theme(colors.amber.500)] [--avatar-ring-b:theme(colors.amber.400)]',
  },
  {
    key: 'green',
    label: 'Green',
    fill: 'bg-green-500/15 text-green-700 dark:text-green-300',
    swatch: 'bg-green-500',
    ring: '[--avatar-ring-a:theme(colors.green.500)] [--avatar-ring-b:theme(colors.green.400)]',
  },
  {
    key: 'teal',
    label: 'Teal',
    fill: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    swatch: 'bg-teal-500',
    ring: '[--avatar-ring-a:theme(colors.teal.500)] [--avatar-ring-b:theme(colors.teal.400)]',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    fill: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
    swatch: 'bg-cyan-500',
    ring: '[--avatar-ring-a:theme(colors.cyan.500)] [--avatar-ring-b:theme(colors.cyan.400)]',
  },
  {
    key: 'blue',
    label: 'Blue',
    fill: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    swatch: 'bg-blue-500',
    ring: '[--avatar-ring-a:theme(colors.blue.500)] [--avatar-ring-b:theme(colors.blue.400)]',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    fill: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
    swatch: 'bg-indigo-500',
    ring: '[--avatar-ring-a:theme(colors.indigo.500)] [--avatar-ring-b:theme(colors.indigo.400)]',
  },
  {
    key: 'violet',
    label: 'Violet',
    fill: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    swatch: 'bg-violet-500',
    ring: '[--avatar-ring-a:theme(colors.violet.500)] [--avatar-ring-b:theme(colors.violet.400)]',
  },
  {
    key: 'pink',
    label: 'Pink',
    fill: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
    swatch: 'bg-pink-500',
    ring: '[--avatar-ring-a:theme(colors.pink.500)] [--avatar-ring-b:theme(colors.pink.400)]',
  },
];

const BY_KEY = new Map(AVATAR_COLORS.map((colour) => [colour.key, colour]));

/**
 * The colour an account renders in.
 *
 * Null, unset and unrecognised all land on `default` — a key this build no
 * longer knows costs its owner a colour, never a render.
 */
export function avatarColor(key: string | null | undefined): AvatarColor {
  return BY_KEY.get((key ?? 'default') as AvatarColorKey) ?? BY_KEY.get('default')!;
}

/** `Michael Rodriguez` → `MR`, `Alex Johnson` → `AJ`, `alex` → `AL`. */
export function userInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function UserAvatar({
  name,
  color,
  src,
  className,
  fallbackClassName,
  initials,
}: {
  name: string | null | undefined;
  color?: string | null;
  /** Only ever set for accounts that arrived through a social provider. */
  src?: string | null;
  className?: string;
  /** Reaches the initials layer — needed where the shape is not a circle. */
  fallbackClassName?: string;
  /** Pre-computed initials, for callers that already flattened the user. */
  initials?: string;
}) {
  const colour = avatarColor(color);

  return (
    <Avatar className={className}>
      {/*
        Normalised away when blank: an empty `src` makes the browser re-request
        the current page, and the fallback is what should render anyway.
      */}
      {src?.trim() ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={cn(colour.fill, fallbackClassName)}>
        {initials ?? userInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
