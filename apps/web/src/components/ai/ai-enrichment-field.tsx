'use client';

import { useId } from 'react';
import Link from 'next/link';
import { IconAlertTriangle, IconArrowRight, IconSparkles } from '@tabler/icons-react';
import { Switch } from '@/components/ui/switch';
import { AI_SETTINGS_HREF, useAiStatus } from '@/hooks/use-ai-status';
import { cn } from '@/lib/utils';

/**
 * The "AI security enrichment" control, wherever a scan is configured.
 *
 * It exists because the toggle used to default to on and stay interactive on an
 * instance with no provider configured: the scan was accepted, ran, and only
 * then reported "No API key configured for openai" in its summary — a failure
 * discovered minutes after the decision that caused it, on a screen the user
 * had not asked to be told about configuration.
 *
 * An unusable provider blocks the switch on EVERY surface — a run starting now
 * and a schedule firing next Monday alike. The schedule used to be exempt, on
 * the reasoning that an admin might finish the setup before the first run; what
 * that produced was a schedule that says "enrichment: on", skips it silently on
 * every run, and gives the operator no signal at all. A toggle should only ever
 * claim what the platform can deliver at the moment it is set, so enrichment is
 * turned on for a schedule once a provider is actually active.
 *
 * `timing` therefore only chooses the wording of the notice, which names the
 * fix and links to it — "configure a provider" is otherwise a page most users
 * have never opened.
 */
export function AiEnrichmentField({
  checked,
  onCheckedChange,
  timing = 'immediate',
  enabled = true,
  className,
}: {
  checked: boolean;
  // eslint-disable-next-line no-unused-vars
  onCheckedChange: (checked: boolean) => void;
  /** Only selects the wording of the unavailable notice — not whether it blocks. */
  timing?: 'immediate' | 'deferred';
  /** Gates the underlying queries — pass the sheet's open state. */
  enabled?: boolean;
  className?: string;
}) {
  const ai = useAiStatus(enabled);

  // Both sheets can be mounted on the same route, so the heading and status ids
  // this control points its ARIA attributes at have to be per-instance.
  const headingId = useId();
  const statusId = useId();

  const blocksToggle = ai.isBlocked;
  const effectiveChecked = blocksToggle ? false : checked;

  return (
    <section className={cn('rounded-lg border px-3 py-2.5', className)} aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <IconSparkles
            className={cn('mt-0.5 size-4 flex-shrink-0', blocksToggle ? 'text-muted-foreground' : 'text-ai')}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 id={headingId} className="text-sm font-medium">
              AI security enrichment
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Adds root cause, business impact and remediation guidance to eligible findings.
            </p>
          </div>
        </div>
        <Switch
          checked={effectiveChecked}
          onCheckedChange={onCheckedChange}
          disabled={blocksToggle || ai.isLoading}
          aria-label="Enable AI security enrichment"
          aria-describedby={statusId}
        />
      </div>

      <div id={statusId} className="mt-2.5 border-t pt-2.5">
        {ai.availability === 'loading' ? (
          <p className="text-xs text-muted-foreground">Checking AI provider…</p>
        ) : ai.availability === 'ready' ? (
          <p className="text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">
              {PROVIDER_LABELS[ai.status?.provider ?? ''] ?? ai.status?.provider}
            </strong>{' '}
            · {ai.status?.model} is ready.
          </p>
        ) : ai.availability === 'unknown' ? (
          <p className="text-xs leading-snug text-muted-foreground">
            Provider status could not be checked. Enrichment will be attempted, and skipped if no
            provider answers.
          </p>
        ) : (
          <AiUnavailableNotice
            canConfigure={ai.canConfigure}
            configuredProviders={ai.status?.configuredProviders ?? []}
            reason={ai.reason}
            timing={timing}
          />
        )}
      </div>
    </section>
  );
}

/**
 * The notice shown when enrichment cannot run.
 *
 * Tinted rather than filled: this is a setup gap, not a scan failure, and the
 * scan itself is unaffected — every plugin still runs and every finding is
 * still recorded. Saying so explicitly is what stops the notice reading as
 * "your scan is broken".
 */
function AiUnavailableNotice({
  canConfigure,
  configuredProviders,
  reason,
  timing,
}: {
  canConfigure: boolean;
  /** Providers holding a credential. Non-empty means "saved but not activated". */
  configuredProviders: string[];
  reason?: string;
  timing: 'immediate' | 'deferred';
}) {
  /*
   * Two failures wearing the same face.
   *
   * A key saved and never activated leaves the effective provider at `none`,
   * exactly like an instance nobody ever touched — but the fix is one click on
   * "Set as active", not another trip to get an API key. Saying which one it is
   * is the whole point of the notice.
   */
  const inactiveOnly = configuredProviders.length > 0;

  const title = inactiveOnly
    ? `${PROVIDER_LABELS[configuredProviders[0]] ?? configuredProviders[0]} is configured but not active`
    : 'No AI provider is connected';

  /*
   * The schedule wording has to carry one extra fact: the switch is off and
   * stays off in what gets saved, so enrichment is something to come back and
   * turn on — not something that starts happening by itself the day a provider
   * appears.
   */
  const consequence =
    timing === 'immediate'
      ? 'Every selected check still runs and every finding is recorded — only the AI commentary is missing.'
      : 'Runs from this schedule still perform every check. Turn enrichment on here once a provider is active.';

  const cta = inactiveOnly
    ? 'Activate it in AI settings'
    : 'Connect a provider — OpenAI, Claude, Gemini, Groq or local Ollama';

  return (
    <div className="flex gap-2.5 rounded-md border border-severity-medium/20 bg-severity-medium/5 px-2.5 py-2">
      <IconAlertTriangle
        className="mt-0.5 size-4 flex-shrink-0 text-severity-medium"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{title}</p>
        {/* The server's own wording, kept inline rather than on its own line —
            it is a diagnostic detail, not a second message. */}
        <p className="mt-0.5 text-xs leading-snug break-words text-muted-foreground">
          {consequence}
          {reason ? ` Reported reason: ${reason}` : ''}
        </p>

        {canConfigure ? (
          <Link
            href={AI_SETTINGS_HREF}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {cta}
            <IconArrowRight className="size-3 flex-shrink-0" aria-hidden="true" />
          </Link>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {inactiveOnly
              ? 'Ask an administrator to activate it in Settings → AI.'
              : 'Ask an administrator to set one up in Settings → AI.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Display names for the provider ids the API reports. */
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Groq',
  ollama: 'Ollama',
};
