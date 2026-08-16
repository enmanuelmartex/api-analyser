'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPencil,
  IconPlus,
  IconSearch,
  IconShield,
  IconTrash,
  IconUserCheck,
  IconUsers,
  IconUserX,
  IconX,
} from '@tabler/icons-react';
import { usersApi } from '@/lib/api';
import type { ManagedUser } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { UserAvatar } from '@/components/shared/user-avatar';
/*
 * `formatDay` and `formatRelativeDay` used to be defined at the bottom of this
 * file against the browser's own timezone. They are the shared, account-aware
 * versions now — the directory said "Yesterday" based on the reader's clock
 * while every other date on the screen came from `lib/utils`, so the two could
 * disagree about which day it was.
 */
import { formatDay, formatRelativeDay } from '@/lib/utils';
import {
  Field,
  SettingsNote,
  SettingsPanel,
  SettingsSection,
} from './_components/settings-primitives';

/*
 * Users.
 *
 * The "Invite by email" flow that used to sit next to "New user" is gone. It
 * never sent an email — this product has no mail transport — so it produced a
 * link the administrator had to deliver by hand, and left a half-created
 * account in the database until the invitee got round to it. Creating the
 * account directly does the same job in one step, and it was already
 * implemented right beside it.
 */

const ROLES = ['ADMIN', 'ANALYST', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full platform access, user management, logs and configuration',
  ANALYST: 'Create projects, run scans and manage findings',
  VIEWER: 'Read-only access to projects and reports',
};

const ROLE_CLASSES: Record<string, string> = {
  ADMIN: 'text-destructive bg-destructive/10 border-destructive/20',
  ANALYST: 'text-primary bg-primary/10 border-primary/20',
  VIEWER: 'text-muted-foreground bg-muted border-border',
};

const MIN_PASSWORD_LENGTH = 8;

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] font-semibold uppercase', ROLE_CLASSES[role] ?? ROLE_CLASSES.VIEWER)}
    >
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-semibold uppercase',
        isActive
          ? 'border-success/20 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {isActive ? 'Active' : 'Disabled'}
    </Badge>
  );
}

/** A password input with a reveal toggle. Repeated in three dialogs otherwise. */
function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  value: string;
  // eslint-disable-next-line no-unused-vars
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({ name: '', email: '', password: '', role: 'ANALYST' });

  const create = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: (user: ManagedUser) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created', {
        description: `${user.name} can sign in with the password you set.`,
      });
      setForm({ name: '', email: '', password: '', role: 'ANALYST' });
      onClose();
    },
    onError: (err: any) =>
      toast.error('Could not create user', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  const valid =
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.password.length >= MIN_PASSWORD_LENGTH;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            The account is usable immediately. Share the password with them directly — nothing is
            emailed.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Full name" htmlFor="new-user-name">
            <Input
              id="new-user-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              required
              autoFocus
            />
          </Field>

          <Field
            label="Email address"
            htmlFor="new-user-email"
            hint="Used to sign in. It cannot be changed afterwards."
          >
            <Input
              id="new-user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="analyst@company.com"
              required
            />
          </Field>

          <Field
            label="Password"
            htmlFor="new-user-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. They can change it from Settings → Security.`}
          >
            <PasswordInput
              id="new-user-password"
              value={form.password}
              onChange={(password) => setForm((f) => ({ ...f, password }))}
              placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
              required
            />
          </Field>

          <Field label="Role" htmlFor="new-user-role">
            <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role }))}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    <span className="font-medium">{ROLE_LABELS[role]}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      — {ROLE_DESCRIPTIONS[role]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!valid}>
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit ─────────────────────────────────────────────────────────────────────

/**
 * Editing an existing user.
 *
 * Name and role only. Email is the sign-in identity and there is no endpoint to
 * change it — showing an editable field that silently discards the value would
 * be worse than showing it read-only, which is what this does.
 */
function EditUserDialog({
  user,
  currentUserId,
  onClose,
}: {
  user: ManagedUser | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<string>('ANALYST');

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
    }
  }, [user]);

  const isSelf = user?.id === currentUserId;

  const save = useMutation({
    mutationFn: async () => {
      // Two endpoints, because the API separates a profile edit from a
      // privilege change — the latter is audited as its own event.
      if (name.trim() !== user!.name) await usersApi.update(user!.id, { name: name.trim() });
      if (role !== user!.role) await usersApi.changeRole(user!.id, role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated');
      onClose();
    },
    onError: (err: any) =>
      toast.error('Could not update user', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  const dirty = Boolean(user) && (name.trim() !== user!.name || role !== user!.role);

  return (
    <Dialog open={Boolean(user)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription>{user.email}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Field label="Full name" htmlFor="edit-user-name">
                <Input
                  id="edit-user-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </Field>

              <Field label="Email address" hint="Sign-in identity. It cannot be changed.">
                <Input value={user.email} readOnly className="cursor-not-allowed text-muted-foreground" />
              </Field>

              <Field
                label="Role"
                htmlFor="edit-user-role"
                hint={
                  isSelf
                    ? 'You cannot change your own role. Ask another administrator.'
                    : ROLE_DESCRIPTIONS[role as Role]
                }
              >
                <Select value={role} onValueChange={setRole} disabled={isSelf}>
                  <SelectTrigger id="edit-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={save.isPending}
                disabled={!dirty || name.trim().length === 0}
                onClick={() => save.mutate()}
              >
                Save changes
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Reset password ───────────────────────────────────────────────────────────

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: ManagedUser | null;
  onClose: () => void;
}) {
  const [password, setPassword] = React.useState('');

  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user!.id, password),
    onSuccess: () => {
      toast.success('Password reset', {
        description: `${user!.name} must use the new password on their next sign-in.`,
      });
      setPassword('');
      onClose();
    },
    onError: (err: any) =>
      toast.error('Could not reset password', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(next) => {
        if (!next) {
          setPassword('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>
                Set a new password for <span className="text-foreground">{user.name}</span>. Their
                existing sessions are not revoked.
              </DialogDescription>
            </DialogHeader>

            <Field label="New password" htmlFor="reset-password">
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={setPassword}
                placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
              />
            </Field>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={reset.isPending}
                disabled={password.length < MIN_PASSWORD_LENGTH}
                onClick={() => reset.mutate()}
              >
                Reset password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Row actions ──────────────────────────────────────────────────────────────

function UserRowActions({
  user,
  currentUserId,
  onEdit,
  onResetPassword,
}: {
  user: ManagedUser;
  currentUserId: string;
  // eslint-disable-next-line no-unused-vars
  onEdit: (user: ManagedUser) => void;
  // eslint-disable-next-line no-unused-vars
  onResetPassword: (user: ManagedUser) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const isSelf = user.id === currentUserId;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const setStatus = useMutation({
    mutationFn: () => usersApi.setStatus(user.id, !user.isActive),
    onSuccess: () => {
      invalidate();
      toast.success(user.isActive ? 'User disabled' : 'User enabled');
    },
    onError: (err: any) =>
      toast.error('Could not update status', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  const remove = useMutation({
    mutationFn: () => usersApi.remove(user.id),
    onSuccess: () => {
      invalidate();
      toast.success('User deleted');
      setConfirmDelete(false);
    },
    onError: (err: any) =>
      toast.error('Could not delete user', {
        description: err?.response?.data?.message ?? 'The API rejected the request.',
      }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${user.name}`}>
            <IconDotsVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs">Manage</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onEdit(user)}>
            <IconPencil className="h-3.5 w-3.5" />
            Edit user
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onResetPassword(user)}>
            <IconKey className="h-3.5 w-3.5" />
            Reset password
          </DropdownMenuItem>

          {/*
            Self-targeted destructive actions are hidden rather than shown
            disabled: the API rejects them anyway, and an administrator locking
            themselves out is the failure mode worth designing against.
          */}
          {!isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={setStatus.isPending} onClick={() => setStatus.mutate()}>
                {user.isActive ? (
                  <>
                    <IconUserX className="h-3.5 w-3.5" /> Disable user
                  </>
                ) : (
                  <>
                    <IconUserCheck className="h-3.5 w-3.5" /> Enable user
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => setConfirmDelete(true)}
              >
                <IconTrash className="h-3.5 w-3.5" />
                Delete user
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <IconTrash />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete “{user.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. They lose all access immediately. Their audit history is kept,
              attributed to a deleted account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [showCreate, setShowCreate] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<ManagedUser | null>(null);
  const [resetTarget, setResetTarget] = React.useState<ManagedUser | null>(null);
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  const { data: users = [], isLoading, isError, refetch } = useQuery<ManagedUser[]>({
    queryKey: ['admin-users'],
    queryFn: usersApi.list,
  });

  /*
   * Filtered in the browser, unlike the log explorer.
   *
   * A user directory is tens of rows, not hundreds of thousands — it already
   * arrives in one response, so a round trip per keystroke would be slower and
   * buy nothing.
   */
  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'disabled' && user.isActive) return false;
      if (!term) return true;
      return (
        user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const activeCount = users.filter((user) => user.isActive).length;
  const filtersActive = search !== '' || roleFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="space-y-5">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-8 pl-8 pr-8 text-xs"
            aria-label="Search users"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>

          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => {
                setSearch('');
                setRoleFilter('all');
                setStatusFilter('all');
              }}
            >
              <IconX className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}

          <Button size="sm" className="h-8 lg:ml-2" onClick={() => setShowCreate(true)}>
            <IconPlus className="h-4 w-4" />
            Add user
          </Button>
        </div>
      </div>

      {/* ── Directory ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    User
                  </TableHead>
                  <TableHead className="h-9 w-[110px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Role
                  </TableHead>
                  <TableHead className="h-9 w-[100px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="hidden h-9 w-[140px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:table-cell">
                    Last activity
                  </TableHead>
                  <TableHead className="hidden h-9 w-[120px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground xl:table-cell">
                    Created
                  </TableHead>
                  <TableHead className="hidden h-9 w-[90px] text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:table-cell">
                    Projects
                  </TableHead>
                  <TableHead className="h-9 w-[50px]" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index} className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-3">
                        <Skeleton className="h-9 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}

                {isError && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7}>
                      <EmptyState
                        icon={IconUsers}
                        title="Could not load users"
                        description="The API did not respond."
                        action={
                          <Button variant="outline" size="sm" onClick={() => refetch()}>
                            Retry
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading &&
                  !isError &&
                  filtered.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            name={user.name}
                            color={user.avatarColor}
                            src={user.avatar}
                            className="h-8 w-8 flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-medium text-foreground">
                                {user.name}
                              </p>
                              {user.id === currentUserId && (
                                <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  you
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={user.role} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge isActive={user.isActive} />
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {user.lastLogin ? formatRelativeDay(user.lastLogin) : 'Never'}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                        {formatDay(user.createdAt)}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground lg:table-cell">
                        {user._count?.projects ?? 0}
                      </TableCell>
                      <TableCell>
                        <UserRowActions
                          user={user}
                          currentUserId={currentUserId}
                          onEdit={setEditTarget}
                          onResetPassword={setResetTarget}
                        />
                      </TableCell>
                    </TableRow>
                  ))}

                {!isLoading && !isError && filtered.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={IconUsers}
                        title={users.length === 0 ? 'No users yet' : 'No users match these filters'}
                        description={
                          users.length === 0
                            ? 'Create the first account to give someone access.'
                            : 'Clear a filter or change the search term.'
                        }
                        action={
                          users.length === 0 ? (
                            <Button size="sm" onClick={() => setShowCreate(true)}>
                              <IconPlus className="h-4 w-4" />
                              Create user
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
          {isLoading ? (
            <Skeleton className="inline-block h-3 w-44 align-middle" />
          ) : (
            <>
              Showing{' '}
              <span className="font-medium tabular-nums text-foreground">{filtered.length}</span> of{' '}
              <span className="font-medium tabular-nums text-foreground">{users.length}</span>{' '}
              account{users.length === 1 ? '' : 's'} · {activeCount} active
            </>
          )}
        </p>
      </div>

      <SettingsPanel>
        <SettingsSection title="Roles" description="What each role can do.">
          <dl className="-my-1 divide-y divide-border">
            {ROLES.map((role) => (
              <div key={role} className="flex items-start gap-3 py-2.5">
                <dt className="w-20 flex-shrink-0">
                  <RoleBadge role={role} />
                </dt>
                <dd className="text-xs leading-relaxed text-muted-foreground">
                  {ROLE_DESCRIPTIONS[role]}
                </dd>
              </div>
            ))}
          </dl>
        </SettingsSection>
      </SettingsPanel>

      <SettingsNote icon={IconShield}>
        Roles are enforced by the API, not by hiding controls. A user who reaches an
        administrator-only endpoint directly is rejected by the server.
      </SettingsNote>

      <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <EditUserDialog
        user={editTarget}
        currentUserId={currentUserId}
        onClose={() => setEditTarget(null)}
      />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}
