'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconInfoCircle } from '@tabler/icons-react';

/**
 * The shared vocabulary of the Settings screens.
 *
 * The governing shape is one surface per tab, divided by hairlines — not a
 * stack of cards. A card draws a box around its contents and says "this is a
 * thing"; eleven boxes down a page say nothing except that someone had a
 * component to hand. Sections here are separated by a rule and a heading, which
 * is enough to group and costs no vertical space.
 *
 * Nothing in this file introduces a colour. Everything resolves to `border`,
 * `muted` and `foreground`, so the panels stay neutral in both themes and
 * colour is left to state — severity, status, destructive intent.
 */

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * The single surface a tab's sections live on.
 *
 * Direct children are separated automatically, so a tab reads as a list of
 * sections rather than a list of floating panels. Content that owns its own
 * border — a table, a log viewer — belongs outside this, not nested in it.
 */
export function SettingsPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A titled block of settings.
 *
 * Padding lives here rather than on the panel, so the panel stays a pure
 * divider and a section keeps the same internal rhythm wherever it is placed.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('px-4 py-5 sm:px-6', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Hairline-separated setting rows. The default container inside a section. */
export function SettingsRows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('-my-1 divide-y divide-border', className)}>{children}</div>;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * One setting: a label and hint on the left, its control on the right.
 *
 * The control is a slot rather than a prop union, so a switch, a select and a
 * number input all produce identically aligned rows — which is what makes a
 * long settings list scannable. Right edges align because the control column
 * never grows; the label column is capped so a long description cannot push it.
 */
export function SettingRow({
  label,
  description,
  hint,
  control,
  className,
  htmlFor,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Extra explanation shown behind an info tooltip rather than inline. */
  hint?: string;
  control: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1 sm:max-w-md">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={htmlFor} className="text-sm font-normal leading-snug text-foreground">
            {label}
          </Label>
          {hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  aria-label={typeof label === 'string' ? `About ${label}` : 'More information'}
                >
                  <IconInfoCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{hint}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 sm:justify-end">{control}</div>
    </div>
  );
}

/** A SettingRow whose control is a switch. The most common shape by far. */
export function SwitchRow({
  id,
  label,
  description,
  hint,
  checked,
  onCheckedChange,
  disabled,
  badge,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  hint?: string;
  checked: boolean;
  // eslint-disable-next-line no-unused-vars
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <SettingRow
      htmlFor={id}
      label={label}
      description={description}
      hint={hint}
      control={
        <>
          {badge}
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-label={label}
          />
        </>
      }
    />
  );
}

/** A read-only fact: label left, value right. Used for statistics panels. */
export function StatRow({
  label,
  value,
  loading,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <span
          className={cn(
            'text-right text-sm font-medium tabular-nums text-foreground',
            mono && 'font-mono text-xs',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// ── Field ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * A form field laid out as a settings row: label on the left, input on the
 * right, aligned with the switches and selects above and below it.
 *
 * This is what keeps Profile from looking like a form bolted onto a settings
 * page — the reference layout puts "Display name" and "Theme" on the same
 * vertical rhythm, and a stacked `Field` breaks it.
 */
export function FieldRow({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1 sm:max-w-md sm:pt-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-normal leading-snug text-foreground">
          {label}
        </Label>
        {error ? (
          <p className="mt-0.5 text-xs text-destructive">{error}</p>
        ) : (
          hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="w-full sm:w-[280px] sm:flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Danger zone ──────────────────────────────────────────────────────────────

/**
 * Irreversible actions, visually fenced off.
 *
 * A tinted border rather than a red panel: the destructive colour belongs to
 * the button that does the thing, and painting the whole block red trains the
 * eye to ignore it.
 */
export function DangerZone({
  title = 'Danger zone',
  description,
  children,
}: {
  title?: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * Marks a value that an administrator has overridden at runtime.
 *
 * Worth its own affordance: without it there is no way to tell a setting that
 * happens to equal its default from one that was deliberately set to that
 * value, which matters when an operator changes the environment and wonders
 * why nothing moved.
 */
export function OverriddenBadge({ envVar }: { envVar: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="neutral" className="h-5 cursor-default px-1.5 text-[10px]">
          Overridden
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Set from this screen, taking precedence over <span className="font-mono">{envVar}</span>.
        Reset it to fall back to the environment value.
      </TooltipContent>
    </Tooltip>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

/** Skeleton rows shaped like `SettingRow`, so loading does not change the layout. */
export function SettingRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="-my-1 divide-y divide-border">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-6 py-3.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-24 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * A footnote under a panel.
 *
 * Used for the standing caveats each tab carries — "roles are enforced by the
 * API", "nothing here is emailed". Outside the panel because they explain the
 * screen rather than configure anything on it.
 */
export function SettingsNote({
  icon: Icon,
  children,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}
