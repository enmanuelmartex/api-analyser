'use client';

import { CircleCheckIcon, CircleDotIcon, CircleIcon, CircleSlashIcon, CircleXIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { AssessmentStatus } from '@/types';

/**
 * The stages of a scan, as the scanner actually runs them.
 *
 * Every entry here corresponds to something the worker really does and really
 * reports — `match` is the step name it emits (`ScannerProcessor.emit`) or the
 * message it puts on the progress stream. Nothing is invented for the sake of a
 * fuller-looking stepper, and no stage advances on a timer: the only inputs are
 * the assessment's persisted `status`, `progress` and `currentStep`, plus the
 * live progress frames, all of which come from the worker.
 *
 * The percentages are the worker's own checkpoints, used only as a fallback
 * when the step name is missing or unrecognised — which is exactly the case for
 * a FAILED run, where `currentStep` is overwritten with the failure reason.
 */
const STAGES = [
  { id: 'prepare', label: 'Preparing scan', minProgress: 0 },
  { id: 'discover', label: 'Discovering endpoints', minProgress: 8 },
  { id: 'checks', label: 'Running security checks', minProgress: 10 },
  { id: 'analyse', label: 'Analysing findings', minProgress: 90 },
  { id: 'persist', label: 'Saving results', minProgress: 92 },
  { id: 'done', label: 'Completed', minProgress: 100 },
] as const;

const TOTAL_STAGES = STAGES.length;

type StageState = 'complete' | 'active' | 'pending' | 'failed' | 'cancelled';

/**
 * Which stage the run is at.
 *
 * Prefers the step name because it is exact; falls back to the percentage,
 * which is the only signal left once the step has been replaced by a failure
 * message. Both are persisted, so a page reload mid-scan resolves to the same
 * stage as the live stream did a moment earlier.
 */
export function resolveStageIndex(step: string | undefined, progress: number): number {
  const name = step?.toLowerCase().trim() ?? '';

  if (name && !name.startsWith('failed')) {
    if (name.includes('complet')) return 5;
    if (name.includes('saving') || name.includes('result')) return 4;
    if (name.includes('ai analysis') || name.includes('analys') || name.includes('analyz')) return 3;
    if (name.includes('pars') || name.includes('discover')) return 1;
    if (name.includes('initial') || name.includes('prepar') || name.includes('queued')) return 0;
    // Anything else while running is a plugin's display name — the scanner emits
    // one step per check, so an unrecognised name means checks are executing.
    return 2;
  }

  // Highest checkpoint the run has passed.
  for (let index = STAGES.length - 1; index >= 0; index -= 1) {
    if (progress >= STAGES[index].minProgress) return index;
  }
  return 0;
}

/**
 * Assessment progress.
 *
 * Replaces a bare percentage bar that could only say "35%" — true, but not an
 * answer to the question actually being asked, which is what the scanner is
 * doing and how much of it is left.
 *
 * Horizontal on a wide viewport and vertical below `sm`: six stage labels in a
 * row are legible on a laptop and unreadable on a phone.
 */
export function AssessmentProgress({
  status,
  progress,
  currentStep,
  message,
  className,
}: {
  status: AssessmentStatus;
  /** The worker's own percentage. Never recomputed from the step count. */
  progress: number;
  currentStep?: string;
  /** Latest live message, e.g. "Running Mass Assignment...". */
  message?: string;
  className?: string;
}) {
  const queued = status === 'QUEUED';
  const failed = status === 'FAILED';
  const cancelled = status === 'CANCELLED';
  const completed = status === 'COMPLETED';

  const stageIndex = completed ? TOTAL_STAGES - 1 : resolveStageIndex(currentStep, progress);
  // A queued run has not started any stage yet, so nothing is complete.
  const completedStages = completed ? TOTAL_STAGES : queued ? 0 : stageIndex;

  const stateFor = (index: number): StageState => {
    if (completed) return 'complete';
    if (index < stageIndex) return 'complete';
    if (index > stageIndex) return 'pending';
    if (failed) return 'failed';
    if (cancelled) return 'cancelled';
    return queued ? 'pending' : 'active';
  };

  const headline = completed
    ? 'Assessment completed'
    : failed
      ? 'Assessment failed'
      : cancelled
        ? 'Assessment cancelled'
        : queued
          ? 'Assessment queued'
          : 'Assessment in progress';

  /*
   * The detail line.
   *
   * `currentStep` carries the failure reason on a FAILED run, which is the most
   * useful thing to show there — so it wins over the stage label rather than
   * being hidden behind it.
   */
  const detail = failed
    ? (currentStep ?? 'The scan stopped before completing.')
    : cancelled
      ? `Stopped during ${STAGES[stageIndex].label.toLowerCase()}.`
      : queued
        ? 'Waiting for a scanner worker to pick up the job.'
        : (message ?? currentStep ?? STAGES[stageIndex].label);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-foreground">{headline}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {completedStages} of {TOTAL_STAGES} steps
          <span className="mx-1.5 text-border">·</span>
          {progress}%
        </p>
      </div>

      <Progress
        value={progress}
        aria-label="Assessment progress"
        className={cn(
          failed && '[&>div]:bg-destructive',
          cancelled && '[&>div]:bg-muted-foreground',
          completed && '[&>div]:bg-success',
        )}
      />

      {/* One column per stage on a wide viewport, one row each below `sm`. */}
      <ol className="grid gap-x-3 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((stage, index) => (
          <StageRow key={stage.id} label={stage.label} state={stateFor(index)} />
        ))}
      </ol>

      <p className="break-words text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function StageRow({ label, state }: { label: string; state: StageState }) {
  const Icon =
    state === 'complete'
      ? CircleCheckIcon
      : state === 'failed'
        ? CircleXIcon
        : state === 'cancelled'
          ? CircleSlashIcon
          : state === 'active'
            ? CircleDotIcon
            : CircleIcon;

  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        state === 'complete' && 'text-foreground',
        state === 'active' && 'font-medium text-primary',
        state === 'failed' && 'font-medium text-destructive',
        state === 'cancelled' && 'text-muted-foreground',
        state === 'pending' && 'text-muted-foreground/60',
      )}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          state === 'complete' && 'text-success',
          state === 'active' && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      <span className="truncate" title={label}>
        {label}
      </span>
      <span className="sr-only">{` — ${state}`}</span>
    </li>
  );
}
