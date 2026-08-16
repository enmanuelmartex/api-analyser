'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  IconBolt,
  IconCheck,
  IconLayersLinked,
  IconPlug,
  IconShieldCheck,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { assessmentsApi, pluginsApi, profilesApi } from '@/lib/api';
import { groupScanProfiles } from '@/lib/scan-profiles';
import type { Assessment, Plugin, Project, ScanProfile } from '@/types';
import { useAiStatus } from '@/hooks/use-ai-status';
import { AiEnrichmentField } from '@/components/ai/ai-enrichment-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type ExecutionMode = 'all' | 'profile' | 'manual';

function getErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.error ?? error.response?.data?.message;
    if (typeof message === 'string') return message;
  }
  return 'The assessment could not be started. Please try again.';
}

/**
 * A label/value pair in the run summary.
 *
 * `break-words` matters on the value: it sits in the grid's `1fr` column, and a
 * long project name or "Unavailable — no active provider" would otherwise widen
 * the row rather than wrap inside it.
 */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-right font-medium">{children}</dd>
    </>
  );
}

/*
 * One row per profile, sized like the execution-mode options above it: name,
 * count, and a single clamped line of description. The list of check names this
 * used to spell out is what made the sheet scroll — and it is redundant, since
 * the Run summary below prints exactly the checks the selected profile
 * resolves to.
 */
function ProfileOption({ profile, selected }: { profile: ScanProfile; selected: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors', selected ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')}>
      <RadioGroupItem value={profile.id} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{profile.name}</span>
          {profile.isSystem && <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] uppercase">System</Badge>}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{profile.enabledPlugins.length} plugins</span>
        </span>
        {profile.description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{profile.description}</span>}
      </span>
    </label>
  );
}

export function RunAssessmentSheet({ project }: { project: Project }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>('all');
  const [profileId, setProfileId] = useState('');
  const [manualPluginIds, setManualPluginIds] = useState<string[]>([]);
  const [enableAiAnalysis, setEnableAiAnalysis] = useState(true);
  const [submitError, setSubmitError] = useState('');

  const pluginsQuery = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: pluginsApi.list,
    enabled: open,
  });
  const profilesQuery = useQuery<ScanProfile[]>({
    queryKey: ['scan-profiles'],
    queryFn: profilesApi.list,
    enabled: open,
    refetchOnMount: 'always',
  });
  /*
   * Enrichment is only ever requested when the platform can actually deliver
   * it. `isBlocked` is true when a provider is missing its key or AI is off for
   * the instance — the two states that used to produce an accepted scan and a
   * failure message in its summary twenty minutes later.
   *
   * A failed status check is deliberately NOT blocking, so a hiccup on
   * `/ai/status` cannot silently strip enrichment from a scan.
   */
  const ai = useAiStatus(open);
  const requestAiAnalysis = enableAiAnalysis && !ai.isBlocked;

  const plugins = pluginsQuery.data ?? [];
  const enabledPlugins = useMemo(() => plugins.filter((plugin) => plugin.isEnabled), [plugins]);
  /*
   * Both groups are offered: the profiles seeded at install and the ones the
   * user saved. The server has always accepted either (`createAndRun` matches
   * `isSystem: true` OR `userId`); it was this component that filtered the
   * seeded ones out and left the picker looking empty.
   */
  const { system: systemProfiles, custom: customProfiles, selectable: profiles } = useMemo(
    () => groupScanProfiles(profilesQuery.data),
    [profilesQuery.data],
  );
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const selectedPlugins = useMemo(() => {
    if (mode === 'all') return enabledPlugins;
    if (mode === 'profile') {
      const ids = new Set(selectedProfile?.enabledPlugins ?? []);
      return enabledPlugins.filter((plugin) => ids.has(plugin.id));
    }
    const ids = new Set(manualPluginIds);
    return enabledPlugins.filter((plugin) => ids.has(plugin.id));
  }, [enabledPlugins, manualPluginIds, mode, selectedProfile]);

  const hasEndpoints = Boolean(project.apiSpec?.endpoints?.length);
  const isValid = hasEndpoints && selectedPlugins.length > 0 && (mode !== 'profile' || Boolean(profileId));

  const mutation = useMutation<Assessment>({
    mutationFn: () => assessmentsApi.run(project.id, {
      executionMode: mode,
      scanProfileId: mode === 'profile' ? profileId : undefined,
      manualPlugins: mode === 'manual' ? manualPluginIds : undefined,
      enableAiAnalysis: requestAiAnalysis,
    }),
    onMutate: () => setSubmitError(''),
    onSuccess: (assessment) => {
      queryClient.setQueryData<Project>(['projects', project.id], (current) => current ? {
        ...current,
        assessments: [assessment, ...(current.assessments ?? []).filter((item) => item.id !== assessment.id)].slice(0, 5),
      } : current);
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
      setOpen(false);
      toast.success('Assessment queued', { description: `${selectedPlugins.length} plugins will run against ${project.name}.` });
      router.push(`/assessments/${assessment.id}`);
    },
    onError: (error) => setSubmitError(getErrorMessage(error)),
  });

  useEffect(() => {
    if (!open) {
      setMode('all');
      setProfileId('');
      setManualPluginIds([]);
      setEnableAiAnalysis(true);
      setSubmitError('');
    }
  }, [open]);

  const toggleManualPlugin = (pluginId: string, checked: boolean) => {
    setManualPluginIds((current) => checked
      ? [...new Set([...current, pluginId])]
      : current.filter((id) => id !== pluginId));
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !mutation.isPending && setOpen(nextOpen)}>
      <SheetTrigger asChild>
        <Button disabled={project.status !== 'READY'}><IconShieldCheck />Run Assessment</Button>
      </SheetTrigger>
      <SheetContent className="flex h-dvh w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Run Assessment</SheetTitle>
          <SheetDescription>Choose exactly which enabled security plugins should scan this project.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-5">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Execution mode</legend>
              <RadioGroup value={mode} onValueChange={(value) => { setMode(value as ExecutionMode); setSubmitError(''); }}>
                {[
                  { value: 'all', title: 'All enabled plugins', description: 'Run every plugin currently enabled in your plugin settings.', icon: IconBolt },
                  { value: 'profile', title: 'Scan profile', description: 'Run a saved set of plugins — a built-in profile or one of your own.', icon: IconLayersLinked },
                  { value: 'manual', title: 'Individual plugins', description: 'Select one or more enabled plugins for this assessment.', icon: IconPlug },
                ].map((option) => {
                  const Icon = option.icon;
                  const selected = mode === option.value;
                  return (
                    <label key={option.value} className={cn('flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', selected ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')}>
                      <RadioGroupItem value={option.value} className="mt-1" />
                      <Icon className="mt-0.5 size-5 text-muted-foreground" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{option.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>

            {mode === 'profile' && (
              <section aria-labelledby="profile-heading" className="space-y-3">
                <h3 id="profile-heading" className="text-sm font-medium">Select a scan profile</h3>
                {profilesQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading profiles…</p> : profiles.length ? (
                  <RadioGroup value={profileId} onValueChange={setProfileId} className="space-y-3">
                    {systemProfiles.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Built-in profiles</p>
                        {systemProfiles.map((profile) => <ProfileOption key={profile.id} profile={profile} selected={profileId === profile.id} />)}
                      </div>
                    )}
                    {customProfiles.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your profiles</p>
                        {customProfiles.map((profile) => <ProfileOption key={profile.id} profile={profile} selected={profileId === profile.id} />)}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No custom profiles yet. <Link href="/plugins/profiles" className="underline underline-offset-2 hover:text-foreground">Create one</Link> to save your own plugin selection.</p>
                    )}
                  </RadioGroup>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-center"><p className="text-sm font-medium">No profiles available</p><p className="mt-1 text-xs text-muted-foreground">Create a reusable plugin selection, then return here to run it.</p><Button asChild variant="link" size="sm" className="mt-2"><Link href="/plugins/profiles">Create a profile</Link></Button></div>
                )}
              </section>
            )}

            {mode === 'manual' && (
              <section aria-labelledby="plugins-heading" className="space-y-3">
                <div className="flex items-center justify-between"><h3 id="plugins-heading" className="text-sm font-medium">Select plugins</h3><span className="text-xs text-muted-foreground">{manualPluginIds.length} selected</span></div>
                {pluginsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading plugins…</p> : enabledPlugins.length ? (
                  <div className="space-y-2">
                    {enabledPlugins.map((plugin) => <label key={plugin.id} className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/50"><Checkbox checked={manualPluginIds.includes(plugin.id)} onCheckedChange={(checked) => toggleManualPlugin(plugin.id, checked === true)} className="mt-0.5" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{plugin.name}</span><Badge variant="outline" className="shrink-0">{plugin.category}</Badge></span><span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{plugin.description}</span></span></label>)}
                  </div>
                ) : <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No plugins are enabled. Enable at least one plugin before running an assessment.</div>}
              </section>
            )}

            <AiEnrichmentField
              checked={enableAiAnalysis}
              onCheckedChange={setEnableAiAnalysis}
              enabled={open}
            />

            <section aria-labelledby="summary-heading" className="rounded-lg border bg-muted/30 px-3.5 py-3">
              <h3 id="summary-heading" className="text-sm font-medium">Run summary</h3>
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                <SummaryRow label="Project">{project.name}</SummaryRow>
                <SummaryRow label="Mode">{{ all: 'All enabled', profile: 'Scan profile', manual: 'Individual plugins' }[mode]}</SummaryRow>
                {selectedProfile && <SummaryRow label="Profile">{selectedProfile.name}</SummaryRow>}
                <SummaryRow label="Plugins">{selectedPlugins.length}</SummaryRow>
                <SummaryRow label="Endpoints">{project.apiSpec?.endpoints?.length ?? 0}</SummaryRow>
                <SummaryRow label="Environment">{project.environment}</SummaryRow>
                <SummaryRow label="AI enrichment">{ai.isBlocked ? 'Unavailable — no active provider' : requestAiAnalysis ? 'Enabled' : 'Disabled'}</SummaryRow>
              </dl>
              {selectedPlugins.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{selectedPlugins.map((plugin) => <Badge key={plugin.id} variant="secondary">{plugin.name}</Badge>)}</div>}
              <p className="mt-2.5 flex gap-2 border-t pt-2.5 text-xs leading-snug text-muted-foreground"><IconCheck className="mt-0.5 size-4 shrink-0" />The assessment may take several minutes. You can follow its status in Recent assessments.</p>
            </section>

            {!hasEndpoints && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Import an OpenAPI specification with at least one endpoint before running an assessment.</p>}
            {submitError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{submitError}</p>}
          </div>
        </ScrollArea>

        <SheetFooter className="border-t bg-card">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!isValid || pluginsQuery.isLoading || profilesQuery.isLoading} loading={mutation.isPending}>Run Assessment</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
