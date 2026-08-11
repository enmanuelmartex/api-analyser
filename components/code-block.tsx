'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A copyable block of commands.
 *
 * Everything a visitor has to *do* to run this project is a command, so the copy
 * button is the primary control on the page — more clicked, probably, than any
 * link. Two consequences:
 *
 *  - What is copied is the raw `code` prop, never the rendered text. The shell
 *    tone draws a `$` prompt in front of each line, and pasting that back into a
 *    terminal would fail on the first character.
 *  - Failure is visible. `navigator.clipboard` is unavailable over plain HTTP on
 *    a non-localhost origin, which is exactly how someone self-hosting this page
 *    might first meet it, so the button says so instead of doing nothing.
 */

type Tone = 'shell' | 'env' | 'yaml' | 'ts';

interface CodeBlockProps {
  code: string;
  /** Filename or context shown in the block's title bar. Omit for no bar. */
  label?: string;
  tone?: Tone;
  className?: string;
}

export function CodeBlock({ code, label, tone = 'shell', className }: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div
      className={cn(
        // `min-w-0` matters: these blocks live inside grid columns, and a grid
        // item's automatic minimum size is its content, so without it a long
        // `uses:` line widens the column and then the page.
        'group/code relative w-full min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60',
        className,
      )}
    >
      {label ? (
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-2">
          <span className="font-mono text-xs text-zinc-500">{label}</span>
          <CopyButton code={code} />
        </div>
      ) : (
        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover/code:opacity-100">
          <CopyButton code={code} />
        </div>
      )}

      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed">
        <code>
          {lines.map((line, index) => (
            <span key={index} className="block whitespace-pre">
              {renderLine(line, tone)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function CopyButton({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      // Insecure origin, or the user denied clipboard access. Saying so beats a
      // button that appears to work and silently does not.
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }, [code]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === 'copied' ? 'Copied to clipboard' : 'Copy to clipboard'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
        state === 'copied'
          ? 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-ice'
          : state === 'failed'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      {state === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

/**
 * Just enough tinting to make a block scannable.
 *
 * Not a tokeniser and not trying to be one — a real highlighter is 40 kB of
 * JavaScript for five short snippets whose shapes are known in advance.
 */
function renderLine(line: string, tone: Tone) {
  if (line.trim() === '') return ' ';

  if (/^\s*(#|\/\/)/.test(line)) {
    return <span className="text-zinc-600">{line}</span>;
  }

  if (tone === 'env') {
    const assignment = line.match(/^([A-Z0-9_]+)(=)(.*)$/);
    if (assignment) {
      return (
        <>
          <span className="text-brand-ice">{assignment[1]}</span>
          <span className="text-zinc-600">=</span>
          <span className="text-zinc-400">{assignment[3]}</span>
        </>
      );
    }
    return <span className="text-zinc-300">{line}</span>;
  }

  if (tone === 'yaml') {
    const entry = line.match(/^(\s*-?\s*)([\w.-]+)(:)(.*)$/);
    if (entry) {
      return (
        <>
          <span>{entry[1]}</span>
          <span className="text-brand-blue">{entry[2]}</span>
          <span className="text-zinc-600">:</span>
          <TrailingComment text={entry[4]} className="text-zinc-300" />
        </>
      );
    }
    return <span className="text-zinc-300">{line}</span>;
  }

  if (tone === 'ts') {
    return (
      <span className="text-zinc-300">
        {line.split(/(\b(?:export|class|extends|readonly|async|await|const|return)\b)/g).map((part, i) =>
          /^(export|class|extends|readonly|async|await|const|return)$/.test(part) ? (
            <span key={i} className="text-brand-violet">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </span>
    );
  }

  // Shell: a dim prompt, the executable in white, its arguments in grey.
  const [command, ...args] = line.split(' ');
  return (
    <>
      <span className="select-none text-zinc-700">$ </span>
      <span className="text-white">{command}</span>
      {args.length > 0 && <TrailingComment text={` ${args.join(' ')}`} className="text-zinc-400" />}
    </>
  );
}

/**
 * Dims an inline `#` comment.
 *
 * `fail_on: HIGH   # CRITICAL | HIGH | MEDIUM` is a value and an aside on one
 * line, and drawing them in the same ink makes the aside look like part of the
 * value someone is about to copy.
 */
function TrailingComment({ text, className }: { text: string; className: string }) {
  const at = text.indexOf('#');
  if (at === -1) return <span className={className}>{text}</span>;
  return (
    <>
      <span className={className}>{text.slice(0, at)}</span>
      <span className="text-zinc-600">{text.slice(at)}</span>
    </>
  );
}
