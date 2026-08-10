'use client';

import { useQuery } from '@tanstack/react-query';
import { IconUser } from '@tabler/icons-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usersApi } from '@/lib/api';
import type { AssignableUser } from '@/types';

/** Sentinel for "nobody" — Radix Select forbids an empty string as a value. */
const UNASSIGNED = '__unassigned__';

/**
 * Assignee picker for an issue.
 *
 * `PATCH /issues/:id/assignee` has existed and been tested throughout, with no
 * control anywhere in the UI, so ownership of a vulnerability could not be
 * recorded at all. The directory comes from `GET /users/assignable`, which
 * returns active accounts only.
 */
export function IssueAssigneeSelect({
  assigneeId,
  onChange,
  disabled,
}: {
  assigneeId: string | null | undefined;
  onChange: (_assigneeId: string | null) => void;
  disabled?: boolean;
}) {
  const { data: users = [], isLoading } = useQuery<AssignableUser[]>({
    queryKey: ['users', 'assignable'],
    queryFn: usersApi.assignable,
    staleTime: 5 * 60_000,
  });

  return (
    <Select
      value={assigneeId ?? UNASSIGNED}
      disabled={disabled || isLoading}
      onValueChange={(value) => onChange(value === UNASSIGNED ? null : value)}
    >
      <SelectTrigger className="h-8 w-full text-xs" aria-label="Assignee">
        <span className="flex min-w-0 items-center gap-1.5">
          <IconUser className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder="Unassigned" />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {users.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            {user.name || user.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
