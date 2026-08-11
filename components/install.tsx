import { Container, GitBranch, Terminal, TriangleAlert } from 'lucide-react';
import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { CodeBlock } from '@/components/code-block';
import { GitHubIcon } from '@/components/icons';
import { quickStart, repo } from '@/lib/site';

/**
 * The install path — the reason this page exists.
 *
 * Everything above sells; this section is the product. It is transcribed from
 * the README's Quick Start rather than paraphrased, including the warning about
 * seeded accounts: that one is the first thing a new user hits, they hit it
 * after ten minutes of setup, and it looks exactly like a broken build. Telling
 * them here costs three lines and saves the issue.
 */

const PREREQUISITE_ICONS = [Terminal, Container, GitBranch];

export function Install() {
  return (
    <Section id="install">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <SectionLabel tone="cyan">Run it locally</SectionLabel>
          <SectionHeading className="mt-6">Clone it, start it, scan something</SectionHeading>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          The whole stack — API, web app, PostgreSQL, Redis and the job queue — comes up from one
          repository. Nothing phones home, and no account on anyone&apos;s server is involved.
        </p>
      </div>

      {/* Prerequisites */}
      <div className="mt-12 grid gap-3 sm:grid-cols-3">
        {quickStart.prerequisites.map((item, index) => {
          const Icon = PREREQUISITE_ICONS[index] ?? Terminal;
          return (
            <div
              key={item.name}
              className="flex items-start gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
              <div>
                <p className="text-sm font-medium text-zinc-100">{item.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{item.note}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* The commands */}
        <div className="min-w-0 space-y-6">
          <Step number="1" title="Clone the repository">
            <CodeBlock code={quickStart.clone} tone="shell" label="terminal" />
          </Step>

          <Step
            number="2"
            title="Configure, install and start"
            note="Migrations and the demo seed run against the containers Docker just started."
          >
            <CodeBlock code={quickStart.install} tone="shell" label="terminal" />
          </Step>

          <Step number="3" title="Open the app">
            <p className="text-sm leading-relaxed text-zinc-400">
              The web app is on{' '}
              <code className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[13px] text-brand-ice">
                http://localhost:3000
              </code>{' '}
              and the API on{' '}
              <code className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[13px] text-brand-ice">
                :4000
              </code>
              . Register an account through the form to get started.
            </p>

            <div className="mt-4 flex gap-3 rounded-xl border border-severity-medium/25 bg-severity-medium/[0.06] p-4">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium" />
              <p className="text-sm leading-relaxed text-zinc-300">
                <span className="font-medium text-white">
                  The seeded accounts do not work for web sign-in.
                </span>{' '}
                <code className="font-mono text-[13px] text-zinc-400">bun run db:seed</code> creates{' '}
                <code className="font-mono text-[13px] text-zinc-400">admin@apianalyser.local</code>{' '}
                and{' '}
                <code className="font-mono text-[13px] text-zinc-400">analyst@apianalyser.local</code>{' '}
                for the REST API only. Register through the UI to get an account the web app
                accepts.
              </p>
            </div>
          </Step>
        </div>

        {/* Configuration and everyday commands */}
        <div className="min-w-0 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Environment</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Copy <code className="font-mono text-[13px] text-zinc-300">.env.example</code> to{' '}
              <code className="font-mono text-[13px] text-zinc-300">.env</code>. Four variables are
              required; the AI key is optional and the scanner runs without it.
            </p>
            <CodeBlock code={quickStart.env} tone="env" label=".env" className="mt-4" />
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-100">Everyday commands</h3>
            <dl className="mt-4 divide-y divide-zinc-800/60 overflow-hidden rounded-xl border border-zinc-800">
              {quickStart.scripts.map((script) => (
                <div
                  key={script.command}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <dt className="font-mono text-[13px] text-brand-ice">{script.command}</dt>
                  <dd className="text-xs text-zinc-500 sm:text-right">{script.description}</dd>
                </div>
              ))}
            </dl>
          </div>

          <a
            href={repo.readmeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <GitHubIcon className="h-4 w-4" />
            Full setup notes, troubleshooting and architecture in the README
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </Section>
  );
}

function Step({
  number,
  title,
  note,
  children,
}: {
  number: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-mono text-[11px] text-zinc-400">
          {number}
        </span>
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
      </div>
      {note && <p className="ml-9 mt-2 text-xs text-zinc-500">{note}</p>}
      <div className="ml-9 mt-3">{children}</div>
    </div>
  );
}
