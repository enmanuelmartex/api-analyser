'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconCircleCheck, IconCircleX, IconAlertTriangle, IconEye, IconEyeOff, IconBolt, IconTrash, IconWifi, IconCircleDot, IconChevronDown } from '@tabler/icons-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { aiApi } from '@/lib/api';
import type { AiProviderConfig, AiProfile, AiTestConnectionResult } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { DeleteConfirmationDialog } from '@/components/shared/delete-confirmation-dialog';
import {
  FieldRow,
  SettingRow,
  SettingsNote,
  SettingsPanel,
  SettingsRows,
  SettingsSection,
  SwitchRow,
} from './_components/settings-primitives';

// ─── Provider Catalog ─────────────────────────────────────────────────────────
// Each provider gets a distinct theme-token hue so cards stay recognizable
// without introducing a second, hardcoded color palette.

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4.1, o4-mini and the full OpenAI model family.',
    tone: 'success',
    icon: 'OA',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', badge: 'Latest' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', badge: 'Recommended' },
      { id: 'o4-mini', label: 'o4 mini', badge: 'Reasoning' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude',
    description: 'Claude Opus, Sonnet, and Haiku — advanced reasoning and safety.',
    tone: 'severity-high',
    icon: 'CL',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', badge: 'Most Capable' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', badge: 'Balanced' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', badge: 'Fast' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini 2.5 and 3.x — multimodal reasoning via Interactions API.',
    tone: 'chart-2',
    icon: 'GM',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', badge: 'Best Quality' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: 'Recommended' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', badge: 'Latest' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', badge: 'Fastest' },
    ],
  },
  {
    id: 'grok',
    name: 'Groq',
    description: 'Ultra-fast inference via Groq Cloud — Llama and GPT-OSS models.',
    tone: 'cyan',
    icon: 'GQ',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', badge: 'Recommended' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', badge: 'Fastest' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', badge: 'Balanced' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run any local model privately — no data leaves your infrastructure.',
    tone: 'chart-3',
    icon: 'OL',
    models: [],
  },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

/**
 * The per-provider hue is an identity cue and nothing more.
 *
 * It used to paint the whole card — border, ring and background — of whichever
 * provider was selected, which meant "selected" looked green for OpenAI, orange
 * for Claude and cyan for Groq. A selection state that changes colour depending
 * on what is selected cannot be learned; the eye has nothing to match against.
 *
 * Selection is now the primary accent everywhere, consistently, and the hue
 * survives only on the two-letter chip — where it does its actual job, which is
 * letting you find Gemini in the list without reading.
 */
const PROVIDER_CHIP: Record<string, string> = {
  success: 'bg-success/15 text-success',
  'severity-high': 'bg-severity-high/15 text-severity-high',
  'chart-2': 'bg-chart-2/15 text-chart-2',
  cyan: 'bg-cyan/15 text-cyan',
  'chart-3': 'bg-chart-3/15 text-chart-3',
};

// ─── AI Profiles ─────────────────────────────────────────────────────────────

const PROFILES: Array<{ id: AiProfile; label: string; description: string; tags: string[] }> = [
  { id: 'minimal', label: 'Minimal', description: 'Critical findings only. Lowest cost.', tags: ['Critical only', 'Executive summary'] },
  { id: 'balanced', label: 'Balanced', description: 'Critical + High. Best for most teams.', tags: ['Critical + High', 'Executive summary'] },
  { id: 'complete', label: 'Complete', description: 'Every severity level gets analyzed.', tags: ['All severities', 'Executive summary'] },
  { id: 'custom', label: 'Custom', description: 'Full manual control over what gets analyzed.', tags: ['Manual selection'] },
];

const PROFILE_PRESETS: Record<string, Record<string, boolean>> = {
  minimal: { analyzeCritical: true, analyzeHigh: false, analyzeMedium: false, analyzeLow: false, executiveSummary: true },
  balanced: { analyzeCritical: true, analyzeHigh: true, analyzeMedium: false, analyzeLow: false, executiveSummary: true },
  complete: { analyzeCritical: true, analyzeHigh: true, analyzeMedium: true, analyzeLow: true, executiveSummary: true },
};

const PROVIDER_DEFAULTS: Record<string, Partial<FormState>> = {
  openai: { model: 'gpt-4o-mini', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  claude: { model: 'claude-haiku-4-5-20251001', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  gemini: { model: 'gemini-2.5-flash', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  grok: { model: 'llama-3.3-70b-versatile', maxTokens: 2000, temperature: 0.2, timeoutMs: 30000, maxFindings: 20 },
  ollama: { model: 'llama3.2:3b', maxTokens: 1000, temperature: 0.2, timeoutMs: 60000, maxFindings: 5, baseUrl: 'http://localhost:11434' },
};

// ─── Form State ───────────────────────────────────────────────────────────────

interface FormState {
  apiKey: string;
  apiKeyChanged: boolean;
  model: string;
  baseUrl: string;
  profile: AiProfile;
  analyzeCritical: boolean;
  analyzeHigh: boolean;
  analyzeMedium: boolean;
  analyzeLow: boolean;
  executiveSummary: boolean;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  maxFindings: number;
  retryAttempts: number;
}

function buildDefaultForm(provider: string): FormState {
  const d = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;
  return {
    apiKey: '',
    apiKeyChanged: false,
    model: d.model ?? 'gpt-4o-mini',
    baseUrl: d.baseUrl ?? '',
    profile: 'balanced',
    analyzeCritical: true,
    analyzeHigh: true,
    analyzeMedium: false,
    analyzeLow: false,
    executiveSummary: true,
    maxTokens: d.maxTokens ?? 2000,
    temperature: d.temperature ?? 0.2,
    timeoutMs: d.timeoutMs ?? 30000,
    maxFindings: d.maxFindings ?? 20,
    retryAttempts: 2,
  };
}

function configToForm(cfg: AiProviderConfig): FormState {
  return {
    apiKey: '',
    apiKeyChanged: false,
    model: cfg.model,
    baseUrl: cfg.baseUrl ?? '',
    profile: cfg.profile,
    analyzeCritical: cfg.analyzeCritical,
    analyzeHigh: cfg.analyzeHigh,
    analyzeMedium: cfg.analyzeMedium,
    analyzeLow: cfg.analyzeLow,
    executiveSummary: cfg.executiveSummary,
    maxTokens: cfg.maxTokens,
    temperature: cfg.temperature,
    timeoutMs: cfg.timeoutMs,
    maxFindings: cfg.maxFindings,
    retryAttempts: cfg.retryAttempts,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AiConfigTab() {
  const qc = useQueryClient();

  const { data: configs = [], isLoading } = useQuery<AiProviderConfig[]>({
    queryKey: ['ai', 'configs'],
    queryFn: aiApi.getAllConfigs,
  });

  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('openai');

  const providerConfig = configs.find((c) => c.provider === selectedProvider);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="w-full space-y-1.5 lg:w-52">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 flex-1 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* ── Provider rail ─────────────────────────────────────────────────── */}
      <div className="w-full flex-shrink-0 lg:w-52">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Providers
        </p>

        {/*
          A radiogroup, not a list of buttons: picking a provider is one choice
          of five, and arrow-key semantics are what a keyboard user expects
          from a rail like this.
        */}
        <div role="radiogroup" aria-label="AI provider" className="space-y-1">
          {PROVIDERS.map((p) => {
            const cfg = configs.find((c) => c.provider === p.id);
            const selected = selectedProvider === p.id;

            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedProvider(p.id as ProviderId)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  selected
                    ? 'border-primary/40 bg-primary/[0.07]'
                    : 'border-border bg-card hover:border-border hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold',
                    PROVIDER_CHIP[p.tone],
                  )}
                  aria-hidden="true"
                >
                  {p.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm',
                      selected ? 'font-medium text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {p.name}
                  </span>
                  <ProviderStatusLine cfg={cfg} />
                </span>
              </button>
            );
          })}
        </div>

        <DisableAiButton configs={configs} qc={qc} />
      </div>

      {/* ── Configuration ─────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <ProviderPanel
          key={selectedProvider}
          providerId={selectedProvider}
          config={providerConfig ?? null}
          configs={configs}
          onSaved={() => qc.invalidateQueries({ queryKey: ['ai', 'configs'] })}
        />
      </div>
    </div>
  );
}

// ─── Provider Status Line (sidebar) ──────────────────────────────────────────

function ProviderStatusLine({ cfg }: { cfg?: AiProviderConfig }) {
  const statusLabel = cfg?.isActive ? 'Active' : cfg?.configSource === 'database' ? 'Configured' : cfg?.envHasKey ? 'Env only' : 'Not set';

  const statusColor = cfg?.isActive ? 'text-primary' : cfg?.configSource === 'database' ? 'text-success' : cfg?.envHasKey ? 'text-severity-medium' : 'text-muted-foreground';

  const testDot = cfg?.lastTestedAt ? (cfg.lastTestSuccess ? 'bg-success' : 'bg-destructive') : null;

  return (
    <span className="mt-0.5 flex items-center gap-1.5">
      <span className={cn('text-[11px]', statusColor)}>{statusLabel}</span>
      {testDot && (
        <span
          className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', testDot)}
          title={cfg?.lastTestMessage ?? ''}
        />
      )}
      {cfg?.envHasKey && !cfg?.isActive && (
        <span
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-severity-medium"
          title="Env var key present"
        />
      )}
    </span>
  );
}

// ─── Disable AI Button ────────────────────────────────────────────────────────

function DisableAiButton({ configs, qc }: { configs: AiProviderConfig[]; qc: ReturnType<typeof useQueryClient> }) {
  const hasActive = configs.some((c) => c.isActive);

  const deactivateMut = useMutation({
    mutationFn: aiApi.deactivateAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'configs'] });
      toast.success('AI analysis disabled.');
    },
    onError: () => toast.error('Failed to disable AI.'),
  });

  if (!hasActive) return null;

  return (
    <button
      type="button"
      onClick={() => deactivateMut.mutate()}
      disabled={deactivateMut.isPending}
      className="mt-3 w-full rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-center text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
    >
      Disable AI analysis
    </button>
  );
}

// ─── Provider Panel (right side) ─────────────────────────────────────────────

function ProviderPanel({
  providerId,
  config,
  configs,
  onSaved,
}: {
  providerId: ProviderId;
  config: AiProviderConfig | null;
  configs: AiProviderConfig[];
  onSaved: () => void;
}) {
  const p = PROVIDER_MAP[providerId];

  const [form, setForm] = useState<FormState>(() => (config ? configToForm(config) : buildDefaultForm(providerId)));
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setIsDirty(true);
    setTestResult(null);
  }

  function selectProfile(profile: AiProfile) {
    const preset = PROFILE_PRESETS[profile];
    setForm((f) => ({ ...f, profile, ...(preset ?? {}) }));
    setIsDirty(true);
  }

  const requiresApiKey = providerId !== 'ollama';
  const hasExistingKey = Boolean(config?.hasKey);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: () =>
      aiApi.saveProviderConfig(providerId, {
        model: form.model,
        apiKey: form.apiKeyChanged ? form.apiKey : undefined,
        baseUrl: form.baseUrl || undefined,
        profile: form.profile,
        analyzeCritical: form.analyzeCritical,
        analyzeHigh: form.analyzeHigh,
        analyzeMedium: form.analyzeMedium,
        analyzeLow: form.analyzeLow,
        executiveSummary: form.executiveSummary,
        maxTokens: form.maxTokens,
        temperature: form.temperature,
        timeoutMs: form.timeoutMs,
        maxFindings: form.maxFindings,
        retryAttempts: form.retryAttempts,
      }),
    onSuccess: () => {
      onSaved();
      setIsDirty(false);
      toast.success(`${p.name} configuration saved.`);
    },
    onError: () => toast.error('Failed to save configuration.'),
  });

  const activateMut = useMutation({
    mutationFn: () => aiApi.activateProvider(providerId),
    onSuccess: () => {
      onSaved();
      toast.success(`${p.name} is now the active AI provider.`);
    },
    onError: () => toast.error('Failed to activate provider.'),
  });

  const deleteMut = useMutation({
    mutationFn: () => aiApi.deleteProviderConfig(providerId),
    onSuccess: () => {
      onSaved();
      setForm(buildDefaultForm(providerId));
      setIsDirty(false);
      toast.success(`${p.name} configuration removed.`);
    },
    onError: () => toast.error('Failed to remove configuration.'),
  });

  const testMut = useMutation({
    mutationFn: (): Promise<AiTestConnectionResult> =>
      aiApi.testProvider(providerId, {
        apiKey: form.apiKeyChanged ? form.apiKey : undefined,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
      }),
    onSuccess: (data) => {
      setTestResult(data);
      onSaved();
      if (data.success) toast.success(`Connected to ${p.name} in ${data.latencyMs}ms`);
      else toast.error(data.message);
    },
    onError: () => setTestResult({ success: false, message: 'Connection test failed.' }),
  });

  const canTest = !testMut.isPending && (!requiresApiKey || hasExistingKey || Boolean(form.apiKey) || Boolean(config?.envHasKey));

  const isConfigured = !requiresApiKey || hasExistingKey || Boolean(form.apiKey) || Boolean(config?.envHasKey);

  const activeProviderName = configs.find((c) => c.isActive)?.provider;
  const isAlreadyActive = config?.isActive;
  const hasDbConfig = config?.configSource === 'database';

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{p.name}</h3>
            {isAlreadyActive && <Badge className="text-[10px] uppercase tracking-wider">Active</Badge>}
            {config?.configSource === 'database' && !isAlreadyActive && (
              <Badge variant="neutral" className="text-[10px]">
                Configured
              </Badge>
            )}
          </div>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
            {p.description}
          </p>
        </div>

        {config?.lastTestedAt && (
          <span
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
              config.lastTestSuccess
                ? 'border-success/20 bg-success/10 text-success'
                : 'border-destructive/20 bg-destructive/10 text-destructive',
            )}
          >
            {config.lastTestSuccess ? (
              <IconCircleCheck className="h-3 w-3" />
            ) : (
              <IconCircleX className="h-3 w-3" />
            )}
            Tested {new Date(config.lastTestedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <SettingsPanel>
        {/* ── Credentials ─────────────────────────────────────────────────── */}
        <SettingsSection
          title="Credentials"
          description={`How this instance authenticates against ${p.name}.`}
        >
          <SettingsRows>
            {requiresApiKey && (
              <FieldRow
                label="API key"
                htmlFor="ai-api-key"
                hint={
                  config?.envHasKey && !hasExistingKey
                    ? 'An environment variable key is present. Saving one here takes priority over it.'
                    : 'Stored encrypted. Only a masked preview is shown once saved.'
                }
              >
                {!form.apiKeyChanged && hasExistingKey ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-muted/60 px-3">
                      <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                        {config?.maskedKey || '••••••••••••••••••••'}
                      </span>
                      <IconCircleCheck className="h-3.5 w-3.5 flex-shrink-0 text-success" />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 flex-shrink-0"
                      onClick={() => {
                        patch('apiKeyChanged', true);
                        patch('apiKey', '');
                      }}
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      id="ai-api-key"
                      type={showKey ? 'text' : 'password'}
                      value={form.apiKey}
                      onChange={(e) => {
                        patch('apiKey', e.target.value);
                        patch('apiKeyChanged', true);
                      }}
                      placeholder={`Enter your ${p.name} API key`}
                      autoComplete="off"
                      className="h-9 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? 'Hide API key' : 'Show API key'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </FieldRow>
            )}

            {providerId === 'ollama' && (
              <FieldRow
                label="Server URL"
                htmlFor="ollama-url"
                hint="Where your Ollama server is reachable from the API container."
              >
                <Input
                  id="ollama-url"
                  type="url"
                  value={form.baseUrl}
                  onChange={(e) => patch('baseUrl', e.target.value)}
                  placeholder="http://localhost:11434"
                  className="h-9"
                />
              </FieldRow>
            )}

            {/*
              The connection test lives with the credentials it tests, as a row
              like any other. It used to float between two cards, which read as
              an action belonging to neither.
            */}
            <SettingRow
              label="Connection"
              description={
                testResult
                  ? undefined
                  : `Verify the key and model against the live ${p.name} API.`
              }
              control={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {testResult && (
                    <span
                      className={cn(
                        'text-xs',
                        testResult.success ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {testResult.success
                        ? `Connected in ${testResult.latencyMs}ms`
                        : testResult.message}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canTest}
                    loading={testMut.isPending}
                    onClick={() => testMut.mutate()}
                  >
                    {!testMut.isPending && <IconWifi className="h-4 w-4" />}
                    {testMut.isPending ? 'Testing…' : 'Test connection'}
                  </Button>
                </div>
              }
            />
          </SettingsRows>
        </SettingsSection>

        {/* ── Model ───────────────────────────────────────────────────────── */}
        <SettingsSection title="Model" description={`Which ${p.name} model performs the analysis.`}>
          <ModelSelector
            providerId={providerId}
            value={form.model}
            onChange={(m) => patch('model', m)}
          />
        </SettingsSection>

        {/* ── Analysis profile ────────────────────────────────────────────── */}
        <SettingsSection
          title="Analysis profile"
          description="Which findings are sent to the AI for enrichment."
        >
          <div role="radiogroup" aria-label="Analysis profile" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {PROFILES.map((pr) => {
              const selected = form.profile === pr.id;
              return (
                <button
                  key={pr.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectProfile(pr.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    selected
                      ? 'border-primary/40 bg-primary/[0.07]'
                      : 'border-border bg-muted/30 hover:border-muted-foreground/30',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        selected ? 'text-foreground' : 'text-foreground/80',
                      )}
                    >
                      {pr.label}
                    </span>
                    {selected && (
                      <IconCircleCheck
                        className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {pr.description}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {pr.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          selected
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {form.profile === 'custom' && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-1">
              <SettingsRows>
                {(
                  [
                    { key: 'analyzeCritical', label: 'Analyse critical findings' },
                    { key: 'analyzeHigh', label: 'Analyse high findings' },
                    { key: 'analyzeMedium', label: 'Analyse medium findings' },
                    { key: 'analyzeLow', label: 'Analyse low findings' },
                    { key: 'executiveSummary', label: 'Generate executive summary' },
                  ] as const
                ).map(({ key, label }) => (
                  <SwitchRow
                    key={key}
                    id={`ai-${key}`}
                    label={label}
                    checked={form[key]}
                    onCheckedChange={(checked) => patch(key, checked)}
                  />
                ))}
              </SettingsRows>
            </div>
          )}
        </SettingsSection>

        {/* ── Advanced ────────────────────────────────────────────────────── */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-muted/40 sm:px-6">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Advanced</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Sampling, limits and timeouts. The defaults suit most instances.
              </span>
            </span>
            <IconChevronDown
              className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-4 pb-5 pt-4 sm:px-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label htmlFor="ai-temperature" className="text-xs font-medium text-muted-foreground">
                    Temperature
                  </Label>
                  <span className="font-mono text-xs tabular-nums text-foreground">
                    {form.temperature.toFixed(1)}
                  </span>
                </div>
                <input
                  id="ai-temperature"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) => patch('temperature', parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>Deterministic</span>
                  <span>Creative</span>
                </div>
              </div>
              <NumberField label="Max tokens" value={form.maxTokens} onChange={(v) => patch('maxTokens', v)} min={100} max={8000} hint="Per API call" />
              <NumberField label="Timeout (ms)" value={form.timeoutMs} onChange={(v) => patch('timeoutMs', v)} min={5000} max={120000} hint="Per API call" />
              <NumberField label="Max findings" value={form.maxFindings} onChange={(v) => patch('maxFindings', v)} min={1} max={100} hint="Sent to AI per scan" />
              <NumberField label="Retry attempts" value={form.retryAttempts} onChange={(v) => patch('retryAttempts', v)} min={0} max={5} hint="On failure" />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-end gap-2 bg-muted/20 px-4 py-3 sm:px-6">
          {hasDbConfig && (
            <DeleteConfirmationDialog
              title={`Remove ${p.name} configuration?`}
              description="The saved provider credentials and configuration will be permanently removed. This action cannot be undone."
              confirmLabel="Remove"
              isDeleting={deleteMut.isPending}
              onConfirm={() => deleteMut.mutateAsync()}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <IconTrash />
                  Remove
                </Button>
              }
            />
          )}

          {isAlreadyActive ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-primary">
              <IconCircleDot className="h-3.5 w-3.5" aria-hidden="true" />
              Active provider
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={!isConfigured}
              loading={activateMut.isPending}
              title={!isConfigured ? `Add an API key for ${p.name} before activating` : undefined}
              onClick={() => activateMut.mutate()}
            >
              {!activateMut.isPending && <IconCircleDot className="h-4 w-4" />}
              Set as active
            </Button>
          )}

          <Button
            size="sm"
            disabled={!isDirty}
            loading={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {!saveMut.isPending && <IconBolt className="h-4 w-4" />}
            {saveMut.isPending ? 'Saving…' : 'Save configuration'}
          </Button>
        </div>
      </SettingsPanel>

      {/*
        The two standing caveats, below the panel rather than wedged between
        the buttons — where the activation hint used to push "Set as Active"
        out of line with everything beside it.
      */}
      {!isConfigured && !isAlreadyActive && (
        <SettingsNote icon={IconAlertTriangle}>
          Save an API key for {p.name} before it can be made the active provider.
        </SettingsNote>
      )}

      {activeProviderName && activeProviderName !== providerId && (
        <SettingsNote icon={IconCircleDot}>
          <span className="font-medium text-foreground">
            {PROVIDER_MAP[activeProviderName]?.name ?? activeProviderName}
          </span>{' '}
          is currently the active provider. Use “Set as active” to switch to {p.name}.
        </SettingsNote>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModelSelector({ providerId, value, onChange }: { providerId: ProviderId; value: string; onChange: (_m: string) => void }) {
  const provider = PROVIDER_MAP[providerId];
  const models = provider?.models ?? [];

  if (providerId === 'ollama') {
    return (
      <SettingsRows>
        <FieldRow
          label="Model name"
          htmlFor="ollama-model"
          hint="Any model installed on your Ollama server."
        >
          <Input
            id="ollama-model"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="llama3.2:3b"
            className="h-9 font-mono text-xs"
          />
        </FieldRow>
      </SettingsRows>
    );
  }

  /*
   * A radiogroup of rows rather than a grid of boxes.
   *
   * The names are monospaced because they are identifiers the operator will
   * paste into a config file, but the row itself is not: a grid of mono-only
   * cards with right-aligned badges gave every option a different visual
   * weight depending on how long its name happened to be.
   */
  return (
    <div role="radiogroup" aria-label="Model" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {models.map((m) => {
        const selected = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(m.id)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              selected
                ? 'border-primary/40 bg-primary/[0.07]'
                : 'border-border bg-muted/30 hover:border-muted-foreground/30',
            )}
          >
            <IconCircleCheck
              className={cn(
                'h-3.5 w-3.5 flex-shrink-0',
                selected ? 'text-primary' : 'text-muted-foreground/25',
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-mono text-xs',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {m.label}
            </span>
            {'badge' in m && m.badge && (
              <span
                className={cn(
                  'flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                  selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {m.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (_v: number) => void;
  min: number;
  max: number;
  hint?: string;
}) {
  const id = `ai-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="h-9 tabular-nums"
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
