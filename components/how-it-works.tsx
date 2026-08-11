'use client';

import { motion } from 'framer-motion';
import { Section, SectionHeading, SectionLabel } from '@/components/section';
import { pipeline } from '@/lib/site';

/**
 * The five stages of an assessment, as a spine.
 *
 * A grid of five equal cards would say these steps are alternatives. They are
 * sequential and each one consumes the previous one's output, so the line
 * through the numbers is doing the explaining and the cards are just where the
 * words sit.
 */
export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionLabel tone="cyan">How an assessment runs</SectionLabel>
          <SectionHeading className="mt-6">From specification to signed report</SectionHeading>
          <p className="mt-6 text-pretty leading-relaxed text-zinc-400">
            No agent to install in your service, no proxy to put in front of it and no code
            change. The scanner works from the contract your API already publishes, and every
            probe it sends is one you can read back in the finding it produced.
          </p>
        </div>

        <ol className="relative space-y-3">
          {/* The spine. It stops short of the last number so it reads as an end. */}
          <span
            aria-hidden="true"
            className="absolute bottom-16 left-[19px] top-4 w-px"
            style={{
              backgroundImage:
                'linear-gradient(180deg, #6D4BFF 0%, #2E8BF5 50%, #1FC2E8 100%)',
              opacity: 0.35,
            }}
          />

          {pipeline.map((stage, index) => (
            <motion.li
              key={stage.step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: index * 0.06 }}
              className="relative flex gap-5"
            >
              <span className="relative z-10 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-400">
                {stage.step}
              </span>
              <div className="flex-1 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700/80">
                <h3 className="text-base font-medium text-white">{stage.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{stage.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
