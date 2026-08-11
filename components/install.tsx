import { Container, KeyRound, Terminal } from 'lucide-react';
import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { CodeBlock } from '@/components/code-block';
import { GitHubIcon } from '@/components/icons';
import { defaultAdmin, installPaths, repo, scripts } from '@/lib/site';

/**
 * The install path — the reason this page exists.
 *
 * Everything above sells; this section is the product. Two routes, side by side
 * rather than behind a tab switcher: the choice between "run it" and "work on
 * it" is one a visitor makes by reading both, and a tab would hide half the
 * answer behind a click and a JavaScript bundle.
 *
 * Docker comes first and is marked recommended because it is the path with no
 * prerequisites beyond Docker itself — no Bun, no Postgres, no secrets to
 * generate. Commands are transcribed from the repository README.
 */

const PATH_ICONS: Record<string, typeof Container> = {
  docker: Container,
  source: Terminal,
};

export function Install() {
  return (
    <Section id="install">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <SectionLabel tone="cyan">Run it locally</SectionLabel>
          <SectionHeading className="mt-6">Two ways in. Both end on localhost</SectionHeading>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          Nothing phones home and no account on anyone&apos;s server is involved. The scanner, the
          database, the queue and the web app all run on your machine.
        </p>
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        {installPaths.map((path) => {
          const Icon = PATH_ICONS[path.id] ?? Terminal;
          return (
            <article
              key={path.id}
              className="flex min-w-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                  <Icon className="h-4 w-4 text-brand-cyan" />
                </span>
                <h3 className="text-base font-medium text-white">{path.label}</h3>
                {'badge' in path && path.badge && (
                  <span className="rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-medium text-brand-ice">
                    {path.badge}
                  </span>
                )}
              </div>

              <p className="mt-4 text-sm leading-relaxed text-zinc-400">{path.summary}</p>
              <p className="mt-3 text-xs text-zinc-600">
                <span className="text-zinc-500">Needs:</span> {path.prerequisites}
              </p>

              <ol className="mt-6 space-y-5">
                {path.steps.map((step, index) => (
                  <li key={step.title} className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 font-mono text-[10px] text-zinc-500">
                        {index + 1}
                      </span>
                      <h4 className="text-sm font-medium text-zinc-200">{step.title}</h4>
                    </div>
                    <CodeBlock code={step.code} tone="shell" dense className="mt-2.5" />
                    {'note' in step && step.note && (
                      <p className="mt-2 text-xs leading-relaxed text-zinc-600">{step.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>

      {/* The credentials, which are the same whichever path was taken. */}
      <div className="mt-5 flex flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-4">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-cyan" />
          <div>
            <h3 className="text-base font-medium text-white">Then sign in</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
              Open{' '}
              <code className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[13px] text-brand-ice">
                http://localhost:3000
              </code>{' '}
              — the API is on{' '}
              <code className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[13px] text-brand-ice">
                :4000
              </code>
              . The first boot creates one administrator against the empty database; that account
              creates everyone else. There is no public sign-up and no OAuth.
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Change the password on first login, or set{' '}
              <code className="font-mono text-[12px] text-zinc-400">ADMIN_PASSWORD</code> before the
              first start.
            </p>
          </div>
        </div>

        <dl className="shrink-0 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 font-mono text-[13px]">
          <div className="flex items-baseline gap-3">
            <dt className="w-20 text-zinc-600">user</dt>
            <dd className="text-zinc-200">{defaultAdmin.email}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="w-20 text-zinc-600">password</dt>
            <dd className="text-zinc-200">{defaultAdmin.password}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">Everyday commands</h3>
          <dl className="mt-4 divide-y divide-zinc-800/60 overflow-hidden rounded-xl border border-zinc-800">
            {scripts.map((script) => (
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

        <div className="min-w-0 self-end">
          <a
            href={repo.readmeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <GitHubIcon className="h-4 w-4" />
            Full setup notes, environment variables and architecture in the README
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </Section>
  );
}
