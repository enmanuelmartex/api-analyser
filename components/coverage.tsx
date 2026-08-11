import { Check, Info } from 'lucide-react';
import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { owaspCoverage, repo } from '@/lib/site';

/**
 * The coverage table, footnotes included.
 *
 * "10 of 10 categories" is the strongest claim on this page, and three of those
 * ten describe more than a black-box scan can observe. The product says so in
 * its coverage API, its UI and every report it generates; a landing page that
 * printed ten ticks and stopped would be the one surface overselling it. So the
 * scope notes are here, in the same table, one click away — not in small print
 * at the bottom.
 *
 * Rendered as static markup with `<details>` rather than React state: the notes
 * are three paragraphs of prose that must be in the DOM for a crawler and must
 * open without JavaScript.
 */
export function Coverage() {
  return (
    <Section id="coverage">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <SectionLabel tone="blue">OWASP API Security Top 10 (2023)</SectionLabel>
          <SectionHeading className="mt-6">
            Ten of ten categories — and where each check stops
          </SectionHeading>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          Coverage is computed from the check manifests at runtime and asserted in the API&apos;s
          own test suite, so the table below cannot quietly drift from the code that produces it.
        </p>
      </div>

      <div className="mt-12 overflow-hidden rounded-2xl border border-zinc-800">
        <div className="hidden grid-cols-[7rem_1fr_auto] gap-4 border-b border-zinc-800 bg-zinc-900/40 px-5 py-3 text-[11px] uppercase tracking-wider text-zinc-500 md:grid">
          <span>Category</span>
          <span>Name</span>
          <span>Security checks</span>
        </div>

        {owaspCoverage.map((row) => (
          <div key={row.id} className="border-b border-zinc-800/60 last:border-b-0">
            <div className="grid gap-2 px-5 py-4 md:grid-cols-[7rem_1fr_auto] md:items-center md:gap-4">
              <span className="font-mono text-xs text-zinc-500">{row.id}</span>

              <span className="flex items-center gap-2 text-sm text-zinc-100">
                <Check className="h-4 w-4 shrink-0 text-brand-cyan" />
                {row.category}
              </span>

              <span className="flex flex-wrap gap-1.5 md:justify-end">
                {row.checks.map((check) => (
                  <code
                    key={check}
                    className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400"
                  >
                    {check}
                  </code>
                ))}
              </span>
            </div>

            {'scopeNote' in row && row.scopeNote && (
              <details className="group px-5 pb-4 md:pl-[8.75rem]">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300">
                  <Info className="h-3.5 w-3.5" />
                  Covered is not the same as exhaustive — what this check can see
                </summary>
                <p className="mt-3 max-w-3xl border-l-2 border-zinc-800 pl-4 text-sm leading-relaxed text-zinc-400">
                  {row.scopeNote}
                </p>
              </details>
            )}
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-zinc-500">
        A tick with a footnote is the honest shape of those three. A tick without one would claim
        more than the product can demonstrate, and no check at all would leave you reading
        &ldquo;no findings&rdquo; as &ldquo;nothing to find&rdquo;.{' '}
        <a
          href={repo.readmeUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand-blue underline-offset-4 hover:underline"
        >
          Read the full coverage notes
        </a>
        .
      </p>
    </Section>
  );
}
