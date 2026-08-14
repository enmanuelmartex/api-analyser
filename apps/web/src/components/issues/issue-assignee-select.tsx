'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserSelect, toUserOption, type UserOption } from '@/components/shared/user-select';
import { usersApi } from '@/lib/api';
import type { AssignableUser, SecurityIssue } from '@/types';

/**
 * Assignee picker for an issue.
 *
 * `PATCH /issues/:id/assignee` has existed and been tested throughout, with no
 * control anywhere in the UI, so ownership of a vulnerability could not be
 * recorded at all. The directory comes from `GET /users/assignable`, which
 * returns active accounts only.
 *
 * Rendering is `UserSelect`, the same avatar picker the audit log filter uses,
 * so a person looks the same wherever the product asks you to pick one.
 */
export function IssueAssigneeSelect({
  assigneeId,
  assignee,
  onChange,
  disabled,
  id,
}: {
  assigneeId: string | null | undefined;
  /**
   * The issue's current assignee as the API returned it. Supplied because
   * `/users/assignable` excludes deactivated accounts: without it, an issue
   * owned by someone since disabled would render as an unnamed row.
   */
  assignee?: SecurityIssue['assignee'];
  // eslint-disable-next-line no-unused-vars
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { data: users = [], isLoading } = useQuery<AssignableUser[]>({
    queryKey: ['users', 'assignable'],
    queryFn: usersApi.assignable,
    staleTime: 5 * 60_000,
  });

  const options = React.useMemo<UserOption[]>(() => {
    const mapped = users.map(toUserOption);
    if (assignee && !mapped.some((option) => option.value === assignee.id)) {
      mapped.push(toUserOption(assignee));
    }
    return mapped;
  }, [users, assignee]);

  return (
    <UserSelect
      id={id}
      ariaLabel="Assignee"
      users={options}
      value={assigneeId ?? null}
      onValueChange={onChange}
      disabled={disabled || isLoading}
      allowUnassigned
      placeholder="Unassigned"
      groupLabel="Select a user"
      emptyMessage="No active accounts to assign."
      className="h-8 w-full text-xs"
    />
  );
}
