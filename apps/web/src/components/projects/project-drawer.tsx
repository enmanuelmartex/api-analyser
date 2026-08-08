'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { IconCheck, IconLoader2 } from '@tabler/icons-react';
import { projectsApi } from '@/lib/api';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const schema = z.object({
  name: z.string().trim().min(1, 'Project name is required.').max(100),
  description: z.string().max(500),
  baseUrl: z.string().trim().url('Enter a valid API base URL.'),
  environment: z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION']),
  specSource: z.enum(['URL', 'UPLOAD']),
  specUrl: z.string(),
  specContent: z.string(),
  authType: z.enum(['NONE', 'BEARER', 'BASIC', 'API_KEY', 'OAUTH2']),
  token: z.string(), username: z.string(), password: z.string(), apiKey: z.string(),
  apiKeyHeader: z.string(), clientId: z.string(), clientSecret: z.string(), tokenUrl: z.string(),
});
type Values = z.infer<typeof schema>;
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
const defaults: Values = { name: '', description: '', baseUrl: '', environment: 'DEVELOPMENT', specSource: 'URL', specUrl: '', specContent: '', authType: 'NONE', token: '', username: '', password: '', apiKey: '', apiKeyHeader: 'X-API-Key', clientId: '', clientSecret: '', tokenUrl: '' };
const labels = ['Project Details', 'API Specification', 'Authentication'];

function message(error: unknown, fallback: string) {
  const data = (error as AxiosError<any>)?.response?.data;
  const value = data?.error ?? data?.message;
  return typeof value === 'string' && !/internal server|stack|sql|json parse/i.test(value) ? value : fallback;
}

export function ProjectDrawer({ open, project, onOpenChange, onChanged }: { open: boolean; project: Project | null; onOpenChange: (_nextOpen: boolean) => void; onChanged: () => void }) {
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);
  const savedSnapshot = useRef('');
  const requestVersion = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const isReadyRef = useRef(false);
  const createDraftPromise = useRef<Promise<string> | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults, mode: 'onTouched' });
  const values = form.watch();

  useEffect(() => {
    if (!open) return;
    const storedAuth = project?.apiSpec?.authConfig?.type;
    const authType: Values['authType'] = storedAuth && storedAuth !== 'CUSTOM' ? storedAuth : 'NONE';
    const next: Values = project ? { ...defaults, name: project.name === 'Untitled project' ? '' : project.name, description: project.description ?? '', baseUrl: project.baseUrl, environment: project.environment, specSource: project.apiSpec?.source === 'URL' ? 'URL' : 'UPLOAD', specUrl: project.apiSpec?.url ?? '', authType } : defaults;
    form.reset(next);
    const existingId = project?.id ?? null;
    projectIdRef.current = existingId;
    isReadyRef.current = project?.status === 'READY';
    createDraftPromise.current = null;
    setProjectId(existingId);
    const nextStep = project?.setupStep ?? 1;
    setStep(nextStep);
    setSaveState(project ? 'saved' : 'idle');
    savedSnapshot.current = JSON.stringify({
      name: next.name,
      description: next.description,
      baseUrl: next.baseUrl,
      environment: next.environment,
      setupStep: nextStep,
    });
  }, [open, project, form]);

  const meaningful = useMemo(() => Boolean(values.name.trim() || values.baseUrl.trim() || values.description.trim() || values.specUrl.trim() || values.specContent.trim()), [values]);
  const draftDetails = useMemo(() => ({
    name: values.name,
    description: values.description,
    baseUrl: values.baseUrl,
    environment: values.environment,
    setupStep: step,
  }), [values.name, values.description, values.baseUrl, values.environment, step]);
  const draftSnapshot = useMemo(() => JSON.stringify(draftDetails), [draftDetails]);

  useEffect(() => {
    if (!open || !meaningful) return;
    if (draftSnapshot === savedSnapshot.current) return;
    setSaveState('dirty');
    const version = ++requestVersion.current;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        await persistDetails(draftDetails);
        if (version !== requestVersion.current) return;
        savedSnapshot.current = draftSnapshot;
        setSaveState('saved');
      } catch { if (version === requestVersion.current) setSaveState('error'); }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [open, meaningful, draftDetails, draftSnapshot, projectId]);

  async function ensureDraft(payload = { name: values.name, description: values.description, baseUrl: values.baseUrl, environment: values.environment, setupStep: step }) {
    if (projectIdRef.current) return projectIdRef.current;
    if (createDraftPromise.current) return createDraftPromise.current;

    createDraftPromise.current = projectsApi.createDraft(payload).then((saved: Project) => {
      projectIdRef.current = saved.id;
      setProjectId(saved.id);
      return saved.id;
    }).finally(() => {
      createDraftPromise.current = null;
    });
    return createDraftPromise.current;
  }
  /**
   * Draft autosave (`PUT /:id/draft`) is rejected by the API once a project is
   * finalized, so a READY project is persisted through the regular update
   * endpoint instead. `setupStep` is draft-only and is dropped for that path.
   */
  async function persistDetails(payload: { name: string; description: string; baseUrl: string; environment: Values['environment']; setupStep: number }) {
    const existingId = projectIdRef.current;
    if (existingId && isReadyRef.current) {
      const { setupStep: _setupStep, ...details } = payload;
      return projectsApi.update(existingId, details);
    }
    if (existingId) return projectsApi.saveDraft(existingId, payload);
    return ensureDraft(payload);
  }
  async function next() {
    if (busy) return;
    if (step === 1) {
      const valid = await form.trigger(['name', 'baseUrl'], { shouldFocus: true });
      if (!valid) return;
      setBusy(true); try { await ensureDraft(); setStep(2); } catch (e) { toast.error(message(e, 'We could not save the project. Please try again.')); } finally { setBusy(false); }
      return;
    }
    if (step === 2) {
      if (values.specSource === 'URL' && !z.string().url().safeParse(values.specUrl).success) { form.setError('specUrl', { message: 'Enter a valid specification URL.' }, { shouldFocus: true }); return; }
      if (values.specSource === 'UPLOAD' && !values.specContent.trim()) { form.setError('specContent', { message: 'Upload a valid OpenAPI JSON or YAML document.' }, { shouldFocus: true }); return; }
      setBusy(true);
      try { const id = await ensureDraft(); if (values.specSource === 'URL') await projectsApi.importFromUrl(id, values.specUrl); else { let parsed; try { parsed = JSON.parse(values.specContent); } catch { form.setError('specContent', { message: 'Upload a valid OpenAPI JSON document.' }, { shouldFocus: true }); return; } await projectsApi.importFromContent(id, parsed); } setStep(3); }
      catch (e) { const field = values.specSource === 'URL' ? 'specUrl' : 'specContent'; form.setError(field, { message: message(e, values.specSource === 'URL' ? 'We could not access the specification URL.' : 'Upload a valid OpenAPI document.') }, { shouldFocus: true }); }
      finally { setBusy(false); }
      return;
    }
    const required: Partial<Record<keyof Values, string>> = values.authType === 'BEARER' ? { token: 'A bearer token is required.' } : values.authType === 'BASIC' ? { username: 'Username is required.', password: 'Password is required.' } : values.authType === 'API_KEY' ? { apiKey: 'An API key is required.', apiKeyHeader: 'Key name is required.' } : values.authType === 'OAUTH2' ? { clientId: 'Client ID is required.', clientSecret: 'Client secret is required.', tokenUrl: 'Token URL is required.' } : {};
    let invalid = false; Object.entries(required).forEach(([key, text]) => { if (!values[key as keyof Values]) { form.setError(key as keyof Values, { message: text }); invalid = true; } }); if (invalid) { await form.trigger(Object.keys(required) as (keyof Values)[], { shouldFocus: true }); return; }
    setBusy(true); try { const id = await ensureDraft(); await projectsApi.saveAuth(id, { type: values.authType, token: values.token || undefined, username: values.username || undefined, password: values.password || undefined, apiKey: values.apiKey || undefined, apiKeyHeader: values.apiKeyHeader || undefined, clientId: values.clientId || undefined, clientSecret: values.clientSecret || undefined, tokenUrl: values.tokenUrl || undefined, scopes: [] }); await projectsApi.finalize(id); toast.success('Project is ready'); onChanged(); onOpenChange(false); }
    catch (e) { toast.error(message(e, 'We could not save the project. Please try again.')); } finally { setBusy(false); }
  }
  async function closeDrawer() {
    if (!meaningful) { onOpenChange(false); return; }
    setBusy(true);
    setSaveState('saving');
    try {
      const details = { name: values.name, description: values.description, baseUrl: values.baseUrl, environment: values.environment, setupStep: step };
      await persistDetails(details);
      savedSnapshot.current = JSON.stringify(details);
      setSaveState('saved');
      onChanged();
      onOpenChange(false);
    } catch (e) {
      setSaveState('error');
      toast.error(message(e, 'We could not save the draft. Please try again.'));
    } finally { setBusy(false); }
  }
  const stateText = { idle: '', dirty: 'Unsaved changes', saving: 'Saving…', saved: project?.status === 'READY' ? 'Changes saved' : 'Draft saved', error: 'Could not save' }[saveState];
  const error = (name: keyof Values) => form.formState.errors[name]?.message;
  const field = (name: keyof Values, label: string, input: React.ReactNode, description?: string) => <Field data-invalid={Boolean(error(name))}><FieldLabel htmlFor={name}>{label}</FieldLabel>{input}{description && <FieldDescription>{description}</FieldDescription>}<FieldError errors={error(name) ? [{ message: error(name) }] : undefined} /></Field>;

  return <Sheet open={open} onOpenChange={(next) => { if (!next) void closeDrawer(); else onOpenChange(true); }}><SheetContent side="right" className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-xl lg:max-w-2xl">
    <SheetHeader className="shrink-0 border-b px-6 py-5 pr-14"><div className="flex items-start justify-between gap-4"><div><SheetTitle>{project ? 'Edit Project' : 'Create New Project'}</SheetTitle><SheetDescription>Configure the project information and API specification.</SheetDescription></div><span aria-live="polite" className={cn('shrink-0 pt-1 text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{saveState === 'saving' && <IconLoader2 className="mr-1 inline h-3 w-3 animate-spin" />}{stateText}</span></div></SheetHeader>
    <div className="shrink-0 border-b px-5 py-3"><ol className="flex items-center justify-between gap-2">{labels.map((label, i) => <li key={label} className={cn('flex min-w-0 items-center gap-2 text-xs', step === i + 1 ? 'text-primary' : step > i + 1 ? 'text-success' : 'text-muted-foreground')}><span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', step === i + 1 && 'border-primary bg-primary/10', step > i + 1 && 'border-success bg-success/10')}>{step > i + 1 ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}</span><span className="hidden truncate sm:block">{label}</span></li>)}</ol></div>
    <form id="project-form" className="min-h-0 flex-1 overflow-y-auto px-6 py-6" onSubmit={(e) => { e.preventDefault(); void next(); }}>
      {step === 1 && <FieldSet><FieldLegend>Project Information</FieldLegend><FieldDescription>Enter the basic information used to identify this project.</FieldDescription><FieldGroup>{field('name', 'Project name', <Input id="name" aria-invalid={!!error('name')} {...form.register('name')} placeholder="My REST API" />, 'Use a clear and recognizable project name.')}{field('baseUrl', 'Base URL', <Input id="baseUrl" type="url" aria-invalid={!!error('baseUrl')} {...form.register('baseUrl')} placeholder="https://api.example.com" />, 'The root URL used for requests during assessments.')}{field('description', 'Description (optional)', <Textarea id="description" aria-invalid={!!error('description')} {...form.register('description')} rows={3} placeholder="What does this API provide?" />)}{field('environment', 'Environment', <Select value={values.environment} onValueChange={(value: Values['environment']) => form.setValue('environment', value, { shouldDirty: true, shouldValidate: true })}><SelectTrigger id="environment" aria-invalid={!!error('environment')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DEVELOPMENT">Development</SelectItem><SelectItem value="STAGING">Staging</SelectItem><SelectItem value="PRODUCTION">Production</SelectItem></SelectContent></Select>)}</FieldGroup></FieldSet>}
      {step === 2 && <FieldSet><FieldLegend>API Specification</FieldLegend><FieldDescription>Import the OpenAPI document that describes the endpoints to assess.</FieldDescription><FieldGroup><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{(['URL','UPLOAD'] as const).map(v => <Button key={v} type="button" variant={values.specSource === v ? 'default' : 'outline'} onClick={() => form.setValue('specSource', v, { shouldDirty: true })}>{v === 'URL' ? 'Import from URL' : 'Paste JSON'}</Button>)}</div>{values.specSource === 'URL' ? field('specUrl', 'OpenAPI URL', <Input id="specUrl" type="url" aria-invalid={!!error('specUrl')} {...form.register('specUrl')} placeholder="https://api.example.com/openapi.json" />) : field('specContent', 'OpenAPI JSON', <Textarea id="specContent" aria-invalid={!!error('specContent')} {...form.register('specContent')} rows={14} className="font-mono text-xs" placeholder="Paste the OpenAPI JSON document" />)}</FieldGroup></FieldSet>}
      {step === 3 && <FieldSet><FieldLegend>Authentication</FieldLegend><FieldDescription>Select how requests to this API should be authenticated.</FieldDescription><FieldGroup><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(['NONE','BEARER','BASIC','API_KEY','OAUTH2'] as const).map(v => <Button key={v} type="button" size="sm" variant={values.authType === v ? 'default' : 'outline'} onClick={() => form.setValue('authType', v, { shouldDirty: true })}>{v.replace('_',' ')}</Button>)}</div>{values.authType === 'BEARER' && field('token','Bearer token',<Input id="token" type="password" aria-invalid={!!error('token')} {...form.register('token')} />)}{values.authType === 'BASIC' && <div className="grid gap-5 sm:grid-cols-2">{field('username','Username',<Input id="username" aria-invalid={!!error('username')} {...form.register('username')} />)}{field('password','Password',<Input id="password" type="password" aria-invalid={!!error('password')} {...form.register('password')} />)}</div>}{values.authType === 'API_KEY' && <div className="grid gap-5 sm:grid-cols-2">{field('apiKeyHeader','Key name',<Input id="apiKeyHeader" aria-invalid={!!error('apiKeyHeader')} {...form.register('apiKeyHeader')} />)}{field('apiKey','API key',<Input id="apiKey" type="password" aria-invalid={!!error('apiKey')} {...form.register('apiKey')} />)}</div>}{values.authType === 'OAUTH2' && <>{field('clientId','Client ID',<Input id="clientId" aria-invalid={!!error('clientId')} {...form.register('clientId')} />)}{field('clientSecret','Client secret',<Input id="clientSecret" type="password" aria-invalid={!!error('clientSecret')} {...form.register('clientSecret')} />)}{field('tokenUrl','Token URL',<Input id="tokenUrl" type="url" aria-invalid={!!error('tokenUrl')} {...form.register('tokenUrl')} />)}</>}</FieldGroup></FieldSet>}
    </form>
    <SheetFooter className="shrink-0 border-t bg-card px-6 py-4">{step > 1 && <Button type="button" variant="outline" onClick={() => setStep(step - 1)} disabled={busy}>Previous</Button>}<Button type="submit" form="project-form" loading={busy}>{step === 3 ? (project ? 'Save changes' : 'Create project') : 'Continue'}</Button></SheetFooter>
  </SheetContent></Sheet>;
}
