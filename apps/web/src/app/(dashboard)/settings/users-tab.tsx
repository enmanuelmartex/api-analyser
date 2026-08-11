'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconUsers, IconPlus, IconShield, IconEye, IconEyeOff, IconUserCheck, IconUserX, IconTrash, IconKey, IconMail, IconDotsVertical } from '@tabler/icons-react';
import { toast } from 'sonner';
import { usersApi } from '@/lib/api';
import type { ManagedUser } from '@/types';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'text-destructive bg-destructive/10 border-destructive/20',
  ANALYST: 'text-primary bg-primary/10 border-primary/20',
  VIEWER: 'text-muted-foreground bg-muted border-border',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] font-semibold uppercase', ROLE_COLORS[role] ?? ROLE_COLORS.VIEWER)}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] font-semibold uppercase', isActive ? 'border-success/20 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground')}>
      {isActive ? 'Active' : 'Disabled'}
    </Badge>
  );
}

// ── Invite by Email Modal ─────────────────────────────────────────────────────

/**
 * Creates an invitation and hands the admin the link.
 *
 * It used to promise an email and, on the overwhelmingly common install with no
 * mail provider configured, send nothing — the link went to the API log, which
 * an admin using the web UI has no reason to be reading. There is no mail
 * transport at all now, so the dialog stays open on success and shows the link
 * to copy. Closing it does not lose the invitation: it is also in the API log,
 * and issuing another one for the same address renews the same invite.
 */
function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ANALYST');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteMut = useMutation({
    mutationFn: () => usersApi.invite({ email: email.trim(), role }),
    onSuccess: (data: any) => {
      toast.success(data?.resent ? `Invitation renewed for ${email}` : `Invitation created for ${email}`);
      setInviteLink(data?.inviteLink ?? null);
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create invitation'),
  });

  function handleClose() {
    setEmail('');
    setInviteLink(null);
    setCopied(false);
    onClose();
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure origin; the link is selectable either way.
      toast.error('Could not copy — select the link and copy it manually');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMut.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Creates a single-use link, valid for 7 days, that lets them set their own password.
            Send it to them however you like — this install does not send email.
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-link">Invitation link for {email}</Label>
              <div className="flex gap-2">
                <Input id="invite-link" readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copyLink} className="shrink-0">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone holding this link can create the account. It is also written to the API log.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="analyst@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANALYST">Analyst — can run scans and view findings</SelectItem>
                <SelectItem value="VIEWER">Viewer — read-only access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={inviteMut.isPending} disabled={!email.trim()}>
              Create invitation
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Create User Modal ─────────────────────────────────────────────────────────

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'ANALYST' });
  const [showPwd, setShowPwd] = useState(false);

  const createMut = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User created');
      setForm({ name: '', email: '', password: '', role: 'ANALYST' });
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create user'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || form.password.length < 8) return;
    createMut.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Full name</Label>
            <Input id="user-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Jane Smith" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email address</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              placeholder="analyst@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">Temporary password</Label>
            <div className="relative">
              <Input
                id="user-password"
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin — full access</SelectItem>
                <SelectItem value="ANALYST">Analyst — read + write scans</SelectItem>
                <SelectItem value="VIEWER">Viewer — read only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={createMut.isPending}>
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose }: { user: ManagedUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const mut = useMutation({
    mutationFn: () => usersApi.resetPassword(user!.id, password),
    onSuccess: () => {
      toast.success(`Password reset for ${user!.name}`);
      setPassword('');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to reset password'),
  });

  return (
    <Dialog open={!!user} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Set a new password for <span className="text-foreground">{user.name}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password (min 8 chars)"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={mut.isPending} disabled={password.length < 8} onClick={() => mut.mutate()}>
                Reset password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Row Actions Menu ──────────────────────────────────────────────────────────

function UserRowActions({
  user,
  currentUserId,
  onResetPassword,
}: {
  user: ManagedUser;
  currentUserId: string;
  onResetPassword: (_u: ManagedUser) => void;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = user.id === currentUserId;

  const roleMut = useMutation({
    mutationFn: (role: string) => usersApi.changeRole(user.id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Role updated');
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to update role'),
  });

  const statusMut = useMutation({
    mutationFn: () => usersApi.setStatus(user.id, !user.isActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(user.isActive ? 'User disabled' : 'User enabled');
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to update status'),
  });

  const deleteMut = useMutation({
    mutationFn: () => usersApi.remove(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deleted');
      setConfirmDelete(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to delete user'),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User actions">
            <IconDotsVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!isSelf && (
            <>
              <DropdownMenuLabel>Change role</DropdownMenuLabel>
              {(['ADMIN', 'ANALYST', 'VIEWER'] as const)
                .filter((r) => r !== user.role)
                .map((r) => (
                  <DropdownMenuItem key={r} disabled={roleMut.isPending} onClick={() => roleMut.mutate(r)}>
                    Set as {ROLE_LABELS[r]}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={() => onResetPassword(user)}>
            <IconKey className="h-3.5 w-3.5" />
            Reset password
          </DropdownMenuItem>

          {!isSelf && (
            <>
              <DropdownMenuItem disabled={statusMut.isPending} onClick={() => statusMut.mutate()}>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={deleteMut.isPending} onClick={() => setConfirmDelete(true)}>
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
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive"><IconTrash /></AlertDialogMedia>
            <AlertDialogTitle>Delete “{user.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. The user will lose all access immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={(event) => { event.preventDefault(); deleteMut.mutate(); }}
            >
              {deleteMut.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [search, setSearch] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: usersApi.list,
  });

  const filtered = users.filter(
    (u: ManagedUser) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Users</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Manage platform users and role assignments</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowInvite(true)}>
                <IconMail className="h-3.5 w-3.5" />
                Invite by email
              </Button>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <IconPlus className="h-3.5 w-3.5" />
                New user
              </Button>
            </div>
          </div>

          <div className="mb-4">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" />
          </div>

          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={IconUsers} title="No users found" compact />
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((user: ManagedUser) => (
                <div key={user.id} className="flex items-center gap-4 py-3.5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20">
                    <span className="text-xs font-medium text-primary">{user.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                      {user.id === currentUserId && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">you</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <RoleBadge role={user.role} />
                    <StatusBadge isActive={user.isActive} />
                  </div>
                  <div className="hidden flex-shrink-0 text-xs text-muted-foreground sm:block">
                    {user.lastLogin ? `Last login ${new Date(user.lastLogin).toLocaleDateString()}` : 'Never logged in'}
                  </div>
                  <UserRowActions user={user} currentUserId={currentUserId} onResetPassword={setResetTarget} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex gap-3 p-4">
          <IconShield className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Role Definitions</p>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-destructive">Admin</span> — full platform access, user management, audit logs
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-primary">Analyst</span> — can create projects, run scans, manage findings
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Viewer</span> — read-only access to projects and reports
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <InviteUserDialog open={showInvite} onClose={() => setShowInvite(false)} />
      <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}
