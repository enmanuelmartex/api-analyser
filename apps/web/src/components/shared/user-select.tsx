'use client';

import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * One row of the picker, already flattened out of whatever user shape the
 * caller holds — `ManagedUser`, `AssignableUser` or the assignee embedded in an
 * issue. `avatar` is optional; `initials` render in its place.
 */
export interface UserOption {
  value: string;
  label: string;
  avatar?: string | null;
  initials?: string;
  /** Optional second line — the email, so two "J. Smith"s stay distinguishable. */
  description?: string | null;
}

/**
 * Sentinel for the "no user" row.
 *
 * Radix Select reserves the empty string for the placeholder state and refuses
 * it as an item value, so "Unassigned" and "All users" need a stand-in. It
 * never leaves this module: the component speaks `string | null` to callers.
 */
const NO_USER = '__no_user__';

/** `Michael Rodriguez` → `MR`, `Alex Johnson` → `AJ`, `alex` → `AL`. */
export function userInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/** Maps any user record the API returns onto the shape the picker renders. */
export function toUserOption(user: {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
}): UserOption {
  // An account created through Better Auth can have a blank name, and a row
  // with an avatar and no label beside it is unreadable.
  const label = user.name?.trim() || user.email?.trim() || 'Unknown user';
  return {
    value: user.id,
    label,
    // Normalised to null: an empty `src` makes the browser re-request the page
    // itself, and the fallback is what should render anyway.
    avatar: user.avatar?.trim() || null,
    initials: userInitials(label),
  };
}

function UserAvatar({ option, className }: { option: UserOption; className?: string }) {
  return (
    <Avatar className={className}>
      {option.avatar ? <AvatarImage src={option.avatar} alt="" /> : null}
      <AvatarFallback className="text-[10px]">
        {option.initials ?? userInitials(option.label)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A user picker that shows an avatar beside each name.
 *
 * Shared by issue triage (assign) and the audit log filter (filter by actor),
 * which are the same control asking two different questions — hence the pair of
 * `allow*` props rather than two components. Both render the "no user" row; only
 * its wording differs, and it always reports `null`.
 */
export function UserSelect({
  users,
  value,
  onValueChange,
  placeholder = 'Select a user',
  groupLabel = 'Select a user',
  allowUnassigned = false,
  unassignedLabel = 'Unassigned',
  allowAll = false,
  allLabel = 'All users',
  emptyMessage = 'No users available.',
  disabled,
  className,
  contentClassName,
  id,
  ariaLabel,
}: {
  users: UserOption[];
  /** `null` selects the "no user" row — unassigned, or unfiltered. */
  value: string | null | undefined;
  // eslint-disable-next-line no-unused-vars
  onValueChange: (userId: string | null) => void;
  placeholder?: string;
  groupLabel?: string;
  allowUnassigned?: boolean;
  unassignedLabel?: string;
  allowAll?: boolean;
  allLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  ariaLabel?: string;
}) {
  // Two labels for one row. `allowAll` wins if a caller passes both, since
  // "everybody" and "nobody" cannot both be the meaning of an absent value.
  const emptyLabel = allowAll ? allLabel : allowUnassigned ? unassignedLabel : null;

  /*
   * A selected id that is not in `users` still has to be representable.
   *
   * `GET /users/assignable` omits deactivated accounts, so an issue assigned
   * before its owner was disabled carries an id with no row behind it. Without
   * a placeholder row Radix would hold a value no item matches and the trigger
   * would read "Unassigned" — quietly misreporting who owns the issue.
   */
  const options = React.useMemo<UserOption[]>(() => {
    if (!value || users.some((user) => user.value === value)) return users;
    return [...users, { value, label: 'Unknown user', initials: '?' }];
  }, [users, value]);

  const selected = value ? (options.find((user) => user.value === value) ?? null) : null;

  return (
    <Select
      value={value ?? (emptyLabel ? NO_USER : '')}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next === NO_USER ? null : next)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        /*
         * Everything here targets `SelectValue`'s span, which Radix renders
         * itself — it drops any `className` passed to it, so the trigger is the
         * only place to reach it.
         *
         * `line-clamp-none` undoes the trigger's own `[&>span]:line-clamp-1`:
         * that sets `display: -webkit-box` with a vertical box orient, which
         * would stack the avatar above the name instead of beside it.
         * Truncation moves to the label, which `flex-1 min-w-0` gives a bounded
         * width to truncate against.
         */
        className={cn(
          '[&>span]:line-clamp-none [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left',
          className,
        )}
      >
        <SelectValue placeholder={placeholder}>
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar option={selected} className="size-5" />
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{emptyLabel ?? placeholder}</span>
          )}
        </SelectValue>
      </SelectTrigger>

      <SelectContent className={cn('max-w-[min(20rem,calc(100vw-2rem))]', contentClassName)}>
        {emptyLabel && (
          <SelectItem value={NO_USER} className="text-muted-foreground">
            {emptyLabel}
          </SelectItem>
        )}

        {options.length > 0 ? (
          <SelectGroup>
            <SelectLabel>{groupLabel}</SelectLabel>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex min-w-0 items-center gap-2">
                  <UserAvatar option={option} className="size-6" />
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ) : (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyMessage}</p>
        )}
      </SelectContent>
    </Select>
  );
}
