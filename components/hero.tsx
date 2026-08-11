'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Terminal } from 'lucide-react';
import { DashboardMockup } from '@/components/dashboard-mockup';
import { GitHubIcon } from '@/components/icons';
import { CodeBlock } from '@/components/code-block';
import { brand, repo, stats } from '@/lib/site';

/**
 * The hero, and the 3D stage the product sits on.
 *
 * The stage is a flat 1600 × 900 render of the dashboard tipped back on three
 * axes and bled past the viewport on both sides, so the product reads as an
 * object with depth rather than a screenshot pasted onto a page. The transform
 * numbers are tuned as a set — changing `rotateX` alone tips it off its
 * vanishing point — and the bottom gradient is what makes it dissolve into the
 * next section instead of ending on a hard edge.
 */
export function Hero() {
  const reduceMotion = useReducedMotion();
  const [parallax, setParallax] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const onScroll = () => setParallax(Math.min(window.scrollY / 300, 1) * -20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduceMotion]);

  return (
    <section id="top" className="relative overflow-hidden bg-brand-canvas pt-16">
      {/* The core gradient, diffused. The only colour above the fold. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[760px] w-[1200px] max-w-[140vw] -translate-x-1/2"
        style={{
          background:
            'radial-gradient(ellipse at 50% 20%, rgba(109,75,255,0.14) 0%, rgba(46,139,245,0.08) 35%, transparent 70%)',
        }}
      />

      <div className="relative z-10">
        <div className="mx-auto w-full max-w-4xl px-5 pt-20 sm:px-6 sm:pt-24">
          <motion.a
            href={repo.url}
            target="_blank"
            rel="noreferrer noopener"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 py-1 pl-1 pr-3 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            <span className="brand-gradient shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white">
              Open source
            </span>
            {/* On a narrow screen the pill plus three clauses wraps into a
                two-line lozenge; the last clause is the one to lose. */}
            <span className="truncate">
              MIT licensed · self-hosted<span className="hidden sm:inline"> · no telemetry</span>
            </span>
            <ArrowRight className="h-3 w-3 shrink-0" />
          </motion.a>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-6 text-balance text-4xl font-medium leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl lg:text-[58px]"
          >
            Automated API security testing for the OWASP API Top&nbsp;10
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-400"
          >
            {brand.name} parses your OpenAPI specification, discovers every endpoint it
            describes, and runs 13 security checks across all ten OWASP API Security Top 10
            categories — then hands you the findings as a PDF, a dashboard, or SARIF your CI
            can fail a build on.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
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
              Run it locally
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.28 }}
            className="mt-6 max-w-xl"
          >
            <CodeBlock code={`git clone ${repo.cloneUrl}`} tone="shell" />
          </motion.div>
        </div>

        {/* The stage — full bleed, tipped back, fading into the page. */}
        {/*
          The plane is a fixed 1600 × 900 and is scaled into whatever room the
          viewport has. The scale and the offset move together — shrinking one
          without the other slides the visible window across the dashboard and
          lands on an empty corner — so both are breakpoint variables read by the
          transform below.
        */}
        <div
          aria-hidden="true"
          // The plane is rotated about its own top-left corner, so its painted
          // top edge sits well above the box that reserves room for it. With
          // little room to reserve it rose 66px over the clone command — the one
          // line on this page someone is here to copy. The stage is pushed clear
          // on the sizes where that happens; from `lg` it already clears.
          className="relative mt-16 h-[300px] [--stage-scale:0.55] [--stage-top:20px] sm:mt-2 sm:h-[440px] sm:[--stage-scale:0.8] sm:[--stage-top:130px] lg:-mt-4 lg:h-[620px] lg:[--stage-scale:1.2] lg:[--stage-top:240px]"
          style={{
            width: '100vw',
            marginLeft: '-50vw',
            marginRight: '-50vw',
            left: '50%',
            right: '50%',
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-56"
            style={{ background: 'linear-gradient(to top, #08080A 18%, transparent 100%)' }}
          />

          <div
            style={{
              transform: `translateY(${parallax}px)`,
              transition: 'transform 0.1s ease-out',
              contain: 'strict',
              perspective: '4000px',
              perspectiveOrigin: '100% 0',
              width: '100%',
              height: '100%',
              transformStyle: 'preserve-3d',
              position: 'relative',
            }}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 1, ease: [0.22, 1, 0.36, 1] }}
              style={{
                backgroundColor: '#08080A',
                transformOrigin: '0 0',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                border: '1px solid #1e1e21',
                borderRadius: '12px',
                width: '1600px',
                height: '900px',
                margin: 'var(--stage-top) auto auto',
                position: 'absolute',
                inset: 0,
                transform:
                  'translate(2%) scale(var(--stage-scale)) rotateX(47deg) rotateY(31deg) rotate(324deg)',
                transformStyle: 'preserve-3d',
                overflow: 'hidden',
                boxShadow: '0 80px 160px -40px rgba(0,0,0,0.9)',
              }}
            >
              <DashboardMockup />
            </motion.div>
          </div>
        </div>

        {/* The headline numbers, sitting in the stage's fade-out. */}
        <div className="relative z-20 mx-auto -mt-8 w-full max-w-5xl px-5 pb-16 sm:px-6 sm:pb-24">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-800/40 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-brand-canvas px-5 py-6 text-center">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block text-3xl font-semibold tracking-tight text-white">
                    {stat.value}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">{stat.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
