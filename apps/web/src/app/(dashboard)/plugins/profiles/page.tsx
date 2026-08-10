'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconPlus,
  IconTrash,
  IconShield,
  IconBolt,
  IconLock,
  IconStack,
  IconList,
  IconCircleCheck,
  IconPuzzle,
  IconStar,
} from '@tabler/icons-react';
import { profilesApi, pluginsApi } from '@/lib/api';
import type { ScanProfile, Plugin } from '@/types';
import { cn } from '@/lib/utils';
import { DeleteConfirmationDialog } from '@/components/shared/delete-confirmation-dialog';
import { toast } from 'sonner';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { SecurityChecksTabs } from '@/components/navigation/security-checks-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';

const PROFILE_ICONS: Record<string, typeof IconShield> = {
  shield: IconShield,
  zap: IconBolt,
  lock: IconLock,
  layers: IconStack,
  list: IconList,
  'check-circle': IconCircleCheck,
  puzzle: IconPuzzle,
};

export default function ProfilesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: profiles = [] } = useQuery<ScanProfile[]>({
    queryKey: ['scan-profiles'],
    queryFn: profilesApi.list,
  });

  const { data: plugins = [] } = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: pluginsApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: profilesApi.delete,
    onMutate: (id) => {
      const previous = queryClient.getQueryData<ScanProfile[]>(['scan-profiles']);
      queryClient.setQueryData<ScanProfile[]>(['scan-profiles'], (old = []) => old.filter((p) => p.id !== id));
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan-profiles'] });
      toast.success('Profile deleted');
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['scan-profiles'], context.previous);
      }
      toast.error('Cannot delete system profiles');
    },
  });

  const systemProfiles = profiles.filter((p) => p.isSystem);
  const userProfiles = profiles.filter((p) => !p.isSystem);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Scan Profiles"
        description="Reusable sets of security checks for targeted scans"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <IconPlus className="h-4 w-4" />
            New Profile
          </Button>
        }
      />

      <SecurityChecksTabs active="profiles" />

      {/* System profiles */}
      <section className="mb-6 space-y-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <IconStar className="h-3 w-3" />
          System Profiles
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {systemProfiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} plugins={plugins} readOnly />
          ))}
        </div>
      </section>

      {/* User profiles */}
      {userProfiles.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom Profiles</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {userProfiles.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} plugins={plugins} isDeleting={deleteMutation.isPending && deleteMutation.variables === profile.id} onDelete={() => deleteMutation.mutateAsync(profile.id)} />
            ))}
          </div>
        </section>
      )}

      {userProfiles.length === 0 && (
        <Card className="border-dashed">
          <CardContent>
            <EmptyState icon={IconPuzzle} title="No custom profiles yet" description="Create one to save your preferred plugin set." compact />
          </CardContent>
        </Card>
      )}

      <CreateProfileDialog
        open={showCreate}
        plugins={plugins}
        onClose={() => setShowCreate(false)}
        onCreated={(newProfile) => {
          queryClient.setQueryData<ScanProfile[]>(['scan-profiles'], (old = []) => [...old, newProfile]);
          setShowCreate(false);
          toast.success('Profile created');
        }}
      />
    </PageContainer>
  );
}

function ProfileCard({
  profile,
  plugins,
  readOnly,
  isDeleting = false,
  onDelete,
}: {
  profile: ScanProfile;
  plugins: Plugin[];
  readOnly?: boolean;
  isDeleting?: boolean;
  onDelete?: () => Promise<unknown>;
}) {
  const Icon = PROFILE_ICONS[profile.icon ?? 'puzzle'] ?? IconPuzzle;
  const pluginNames = profile.enabledPlugins.map((id) => plugins.find((p) => p.id === id)?.name ?? id).slice(0, 4);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                {profile.name}
                {readOnly && (
                  <Badge variant="secondary" className="text-[9px]">
                    SYSTEM
                  </Badge>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">{profile.enabledPlugins.length} plugins</p>
            </div>
          </div>
          {!readOnly && onDelete && (
            <DeleteConfirmationDialog
              title={`Delete “${profile.name}”?`}
              description="This profile will be permanently deleted and will no longer be available for future scans."
              isDeleting={isDeleting}
              onConfirm={onDelete}
              trigger={<Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${profile.name}`}><IconTrash /></Button>}
            />
          )}
        </div>

        {profile.description && <p className="text-xs leading-relaxed text-muted-foreground">{profile.description}</p>}

        <div className="flex flex-wrap gap-1">
          {pluginNames.map((name) => (
            <span key={name} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {name}
            </span>
          ))}
          {profile.enabledPlugins.length > 4 && (
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{profile.enabledPlugins.length - 4} more
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateProfileDialog({
  open,
  plugins,
  onClose,
  onCreated,
}: {
  open: boolean;
  plugins: Plugin[];
  onClose: () => void;
  onCreated: (_profile: ScanProfile) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: () => profilesApi.create({ name, description, enabledPlugins: selected }),
    onSuccess: (data) => {
      onCreated(data);
      setName('');
      setDescription('');
      setSelected([]);
    },
    onError: () => toast.error('Failed to create profile'),
  });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Scan Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Profile Name *</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Custom Profile" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-description">Description</Label>
            <Input id="profile-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description…" />
          </div>

          <div className="space-y-2">
            <Label>Plugins ({selected.length} selected)</Label>
            <div className="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto">
              {plugins.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                    selected.includes(p.id) ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-foreground/30',
                  )}
                >
                  {selected.includes(p.id) && <IconCircleCheck className="h-3 w-3 flex-shrink-0" />}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name || selected.length === 0} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
