import { ShieldAlert, Terminal } from 'lucide-react';
import { GitHubIcon } from '@/components/icons';
import { CodeBlock } from '@/components/code-block';
import { brand, repo } from '@/lib/site';

/**
 * The closing band: the legal reality of the tool, then the call to action.
 *
 * The notice comes first deliberately. This is a scanner that sends real
 * requests to real hosts, and the last thing someone reads before they click
 * "clone" should be the sentence about permission — not a footnote below the
 * fold that nobody scrolls to.
 */
export function CallToAction() {
  return (
    <section className="relative bg-brand-canvas pb-16 pt-16 sm:pb-24 sm:pt-24 lg:pb-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 30%, rgba(255,255,255,0.07) 70%, transparent)',
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6">
        <div className="flex gap-4 rounded-2xl border border-severity-critical/25 bg-severity-critical/[0.05] p-6">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-severity-critical" />
          <div>
            <h2 className="text-base font-medium text-white">
              {brand.name} is for authorised security testing only
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Only run it against APIs you own or have explicit written permission to test.
              Unauthorised API testing may violate computer fraud laws in your jurisdiction. The
              scanner sends real requests to the host you nominate — it never probes a host you did
              not name, and that boundary only protects you if you nominate honestly.
            </p>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl lg:text-[42px]">
              Clone it. Point it at a spec. Read the report.
            </h2>
            <p className="mt-5 leading-relaxed text-zinc-400">
              Free and MIT licensed. It runs on your machine, the findings stay in your database,
              and nothing about your API leaves the network you started it on.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={repo.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200"
              >
                <GitHubIcon className="h-4 w-4" />
                View on GitHub
              </a>
              <a
                href="#install"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
              >
                <Terminal className="h-4 w-4" />
                Quick start
              </a>
            </div>
          </div>

          <div className="w-full min-w-0 max-w-md">
            <CodeBlock
              code={`git clone ${repo.cloneUrl}\ncd ${repo.name}\nbun i\ndocker compose up -d\nbun dev`}
              tone="shell"
              label="five commands"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
