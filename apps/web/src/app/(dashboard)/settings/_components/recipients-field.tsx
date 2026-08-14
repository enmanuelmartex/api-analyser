'use client';

import * as React from 'react';
import { IconMail, IconPlus, IconX } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Mirrors the server's rule in `apps/api/src/modules/settings/email-list.ts`.
 *
 * Duplicated deliberately, and it is the API that enforces it — this copy only
 * exists so a typo is caught while the operator is still looking at the field,
 * rather than as a toast after a round trip. If they disagree the server wins,
 * and the worst outcome is a rejected save with a clear message.
 */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>".]{2,}$/;

function normalise(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * An editable list of email addresses.
 *
 * Chips rather than a comma-separated text field. A text field makes the whole
 * list one thing to get wrong — a stray comma silently changes who receives a
 * security report — while a chip is an address that either exists or does not,
 * and removing one is unambiguous.
 *
 * `onChange` fires with the complete next list, so the caller saves a whole
 * value rather than a diff. That matches how the settings API works: a list
 * setting is written entire, and there is no partial state to reconcile.
 */
export function RecipientsField({
  value,
  onChange,
  disabled,
  max,
  inputId = 'recipients-input',
  emptyHint = 'No addresses yet.',
}: {
  value: string[];
  // eslint-disable-next-line no-unused-vars
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
  inputId?: string;
  emptyHint?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const atCapacity = max !== undefined && value.length >= max;

  /**
   * Accepts one address or several at once.
   *
   * The multi-address path matters more than it looks: the realistic way this
   * field gets filled is by pasting a list out of a spreadsheet or an email
   * client, and a field that takes only one at a time turns that into eight
   * separate interactions.
   */
  function add(raw: string) {
    const candidates = raw
      .split(/[,;\n\r\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (candidates.length === 0) return;

    const existing = new Set(value.map(normalise));
    const accepted: string[] = [];

    for (const candidate of candidates) {
      if (!ADDRESS.test(candidate)) {
        setError(`"${candidate}" is not a valid email address.`);
        return;
      }
      if (existing.has(normalise(candidate)) || accepted.some((a) => normalise(a) === normalise(candidate))) {
        continue;
      }
      accepted.push(candidate);
    }

    if (max !== undefined && value.length + accepted.length > max) {
      setError(`At most ${max} addresses.`);
      return;
    }

    setError(null);
    setDraft('');
    if (accepted.length > 0) onChange([...value, ...accepted.map(normalise)]);
  }

  function remove(address: string) {
    setError(null);
    onChange(value.filter((entry) => entry !== address));
  }

  return (
    <div className="w-full space-y-3">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((address) => (
            <li key={address}>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 py-1 pl-2.5 pr-1 text-xs text-foreground',
                  disabled && 'opacity-60',
                )}
              >
                <IconMail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[22ch] truncate font-mono" title={address}>
                  {address}
                </span>
                <button
                  type="button"
                  onClick={() => remove(address)}
                  disabled={disabled}
                  aria-label={`Remove ${address}`}
                  className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}

      <div className="flex gap-2">
        <Input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="security@yourcompany.com"
          value={draft}
          disabled={disabled || atCapacity}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          // Enter adds rather than submitting whatever form this sits in.
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add(draft);
            }
          }}
          // A pasted list is split immediately, so the operator sees chips
          // rather than a line of text they then have to fix.
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text');
            if (/[,;\n]/.test(pasted)) {
              event.preventDefault();
              add(pasted);
            }
          }}
          className={cn('h-9 font-mono text-xs', error && 'border-destructive')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => add(draft)}
          disabled={disabled || atCapacity || draft.trim().length === 0}
        >
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {atCapacity && !error && (
        <p className="text-xs text-muted-foreground">
          The maximum of {max} addresses has been reached.
        </p>
      )}
    </div>
  );
}
