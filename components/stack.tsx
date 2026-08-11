import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { CodeBlock } from '@/components/code-block';
import { ciWorkflow, pluginSnippet, repo, techStack } from '@/lib/site';

/**
 * What it is made of, and the two ways it is meant to be extended.
 *
 * This section is aimed at the person deciding whether to fork rather than the
 * person deciding whether to try: a stack they can read, a workflow they can
 * paste, and the shape of a plugin so they can see how small a new check is.
 */
export function Stack() {
  return (
    <Section id="stack">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <SectionLabel tone="amber">Under the hood</SectionLabel>
          <SectionHeading className="mt-6">A stack you can read in an afternoon</SectionHeading>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          One Bun workspace, two apps, no magic. Every dependency is a boring, well-documented
          one, and the scanner is a set of plugins with a single method each.
        </p>
      </div>

      <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800/60 sm:grid-cols-2 lg:grid-cols-5">
        {techStack.map((entry) => (
          <div key={entry.layer} className="bg-brand-canvas px-5 py-5">
            <dt className="text-[11px] uppercase tracking-wider text-zinc-500">{entry.layer}</dt>
            <dd className="mt-2 text-sm leading-snug text-zinc-200">{entry.value}</dd>
          </div>
        ))}
      </dl>

      {/* Uneven columns: the workflow's `uses:` line is the longest string on the
          page, and an even split cuts it off mid-path. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6">
          <h3 className="text-base font-medium text-white">Gate a pull request</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Point the reusable workflow at a deployed environment and choose the severity that
            fails the build. Results land in the GitHub Security tab as SARIF.
          </p>
          <CodeBlock code={ciWorkflow} tone="yaml" label=".github/workflows/security.yml" className="mt-5" />
        </div>

        <div className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6">
          <h3 className="text-base font-medium text-white">Write your own check</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            A plugin is one class with one method. Register it in{' '}
            <code className="font-mono text-[13px] text-zinc-300">scanner.service.ts</code> and it
            runs in every assessment from then on.
          </p>
          <CodeBlock code={pluginSnippet} tone="ts" label="my-check.plugin.ts" className="mt-5" />
        </div>
      </div>

      <p className="mt-8 text-sm text-zinc-500">
        The full module map lives in{' '}
        <a
          href={repo.architectureUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand-blue underline-offset-4 hover:underline"
        >
          ARCHITECTURE.md
        </a>
        .
      </p>
    </Section>
  );
}
