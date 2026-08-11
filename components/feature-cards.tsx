'use client';

import { motion } from 'framer-motion';
import { Check, FileWarning, ShieldAlert } from 'lucide-react';
import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { GitHubIcon } from '@/components/icons';

/**
 * Three claims, each with the interface that backs it up.
 *
 * The illustrations are fragments of the real product rather than abstract
 * shapes: a finding with its evidence, the model picker, a failing CI check.
 * Someone deciding whether to spend twenty minutes cloning a repository wants to
 * see the thing, and a gradient blob shows them nothing.
 */

const CARDS = [
  {
    title: 'Every finding carries its evidence',
    body: 'The request that produced it, the response that proved it, and the OWASP category it belongs to.',
    illustration: <EvidenceIllustration />,
  },
  {
    title: 'AI triage, and an off switch',
    body: 'Bring your own key for OpenAI, Claude, Gemini or Grok — or point it at a local Ollama model. Skip it and the scan is unchanged.',
    illustration: <ModelIllustration />,
  },
  {
    title: 'A gate your pipeline can fail on',
    body: 'SARIF uploads into the GitHub Security tab, and a threshold you choose blocks the pull request.',
    illustration: <PipelineIllustration />,
  },
] as const;

export function FeatureCards() {
  return (
    <Section>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-md">
          <SectionLabel tone="violet">What you actually get</SectionLabel>
          <SectionHeading className="mt-6">Built to be read, not just run</SectionHeading>
        </div>
        <p className="max-w-md leading-relaxed text-zinc-400">
          A scanner that reports a number nobody can check is a scanner nobody acts on. Every
          result here names what was sent, what came back, and where the check stops seeing —
          so a finding can be argued with, and a clean result means something.
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {CARDS.map((card, index) => (
          <motion.article
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: index * 0.08 }}
            // The card is a fixed frame with the illustration pinned to its top
            // and the words to its bottom. In one full-width column the words
            // wrap less, so the same frame opens a hole in the middle — the
            // frame and the illustration shrink together to close it.
            className="group relative flex h-[340px] flex-col justify-end overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/30 transition-colors hover:border-zinc-700 sm:h-[380px]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[200px] sm:h-[240px]"
              style={{
                maskImage: 'linear-gradient(#000 62%, transparent 96%)',
                WebkitMaskImage: 'linear-gradient(#000 62%, transparent 96%)',
              }}
            >
              {card.illustration}
            </div>

            <div className="relative z-10 p-6">
              <h3 className="text-base font-medium leading-snug text-white">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{card.body}</p>
            </div>
          </motion.article>
        ))}
      </div>
    </Section>
  );
}

function EvidenceIllustration() {
  return (
    <div className="space-y-2 p-5">
      <div className="flex items-center gap-2 rounded-lg border border-severity-critical/25 bg-severity-critical/[0.07] px-3 py-2.5">
        <ShieldAlert className="h-4 w-4 shrink-0 text-severity-critical" />
        <span className="text-xs text-zinc-200">Broken Object Level Authorization</span>
        <span className="ml-auto rounded bg-severity-critical/15 px-1.5 py-0.5 text-[10px] font-medium text-severity-critical">
          Critical
        </span>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-[11px] leading-relaxed">
        <p className="text-zinc-600">// evidence</p>
        <p>
          <span className="text-brand-cyan">GET</span>
          <span className="text-zinc-400"> /api/v1/orders/</span>
          <span className="text-severity-medium">1042</span>
        </p>
        <p className="text-zinc-500">Authorization: Bearer &lt;user-b&gt;</p>
        <p className="mt-1.5">
          <span className="text-severity-critical">200 OK</span>
          <span className="text-zinc-500"> — returned another user&apos;s order</span>
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <FileWarning className="h-3.5 w-3.5 text-severity-high" />
        <span className="text-[11px] text-zinc-400">API1:2023 · bola</span>
      </div>
    </div>
  );
}

function ModelIllustration() {
  const models = [
    { name: 'OpenAI · gpt-4o-mini', selected: true },
    { name: 'Claude', selected: false },
    { name: 'Gemini', selected: false },
    { name: 'Grok', selected: false },
    { name: 'Ollama · local', selected: false },
  ];

  return (
    <div className="p-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-500">
        AI analysis provider
      </div>
      <div className="mt-1.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/60">
        {models.map((model, index) => (
          <div
            key={model.name}
            className={`flex items-center justify-between px-3 py-2.5 text-xs ${
              model.selected ? 'bg-zinc-800/70 text-white' : 'text-zinc-400'
            }`}
            style={model.selected ? undefined : { opacity: 1 - index * 0.14 }}
          >
            <span className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${model.selected ? 'bg-brand-cyan' : 'bg-zinc-700'}`}
              />
              {model.name}
            </span>
            {model.selected && <Check className="h-3.5 w-3.5 text-brand-cyan" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineIllustration() {
  const checks = [
    { label: 'build', state: 'pass' },
    { label: 'test', state: 'pass' },
    { label: 'api-security-gate', state: 'fail' },
  ] as const;

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <GitHubIcon className="h-3.5 w-3.5" />
        <span>All checks have failed</span>
      </div>

      <div className="mt-3 divide-y divide-zinc-800/70 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/60">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2.5 px-3 py-2.5 text-xs">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                check.state === 'pass'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-severity-critical/15 text-severity-critical'
              }`}
            >
              {check.state === 'pass' ? '✓' : '✕'}
            </span>
            <span className={check.state === 'pass' ? 'text-zinc-500' : 'text-zinc-200'}>
              {check.label}
            </span>
            {check.state === 'fail' && (
              <span className="ml-auto text-[10px] text-severity-critical">2 HIGH findings</span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 font-mono text-[10px] text-zinc-600">
        results uploaded to GitHub Security · SARIF
      </p>
    </div>
  );
}
