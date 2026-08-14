'use client';

import { useQuery } from '@tanstack/react-query';
import { IconBolt, IconGitBranch, IconShield, IconTerminal2 } from '@tabler/icons-react';
import { pluginsApi } from '@/lib/api';
import { appBrand } from '@/lib/brand';
import { BrandLogo } from '@/components/brand/brand-logo';
import { Badge } from '@/components/ui/badge';
import { SettingsPanel, SettingsSection } from './_components/settings-primitives';

const STACK = [
  'NestJS 10',
  'Next.js 15',
  'React 19',
  'PostgreSQL 16',
  'Redis 7',
  'BullMQ 5',
  'Prisma ORM',
  'TypeScript 5',
  'Bun Runtime',
  'TanStack Query',
  'Tailwind CSS',
  'Recharts',
];

export function AboutTab() {
  /*
   * The capability tiles are read from the plugin registry rather than written
   * here. The hand-written version claimed eleven checks and full Top 10
   * coverage while ten checks were installed and three categories had nothing
   * behind them at all.
   */
  const { data: coverage } = useQuery({
    queryKey: ['plugins', 'owasp-coverage'],
    queryFn: pluginsApi.owaspCoverage,
    staleTime: 5 * 60_000,
  });

  return (
    <SettingsPanel>
      {/*
        The identity block is the one place in Settings that centres its
        content: it is a masthead, not a list of settings, and aligning it left
        alongside the sections below reads as a section whose control is
        missing.
      */}
      <div className="flex flex-col items-center px-4 py-8 text-center sm:px-6">
        <BrandLogo type="symbol" size={56} className="mb-4" />
        <h2 className="text-lg font-semibold text-foreground">{appBrand.name}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{appBrand.tagline}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{appBrand.domain}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">v0.1.0</span>
          <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
          <Badge variant="default" className="text-[10px]">
            Open Source MVP
          </Badge>
        </div>
      </div>

      <SettingsSection title="About this project" description="Mission and objectives.">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {appBrand.name} is an open source platform for automated security evaluation of RESTful
          APIs, aligned with the{' '}
          <span className="font-medium text-primary">OWASP API Security Top 10</span>. It detects
          vulnerabilities, generates professional reports, and manages multiple projects and users
          across organisations.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                icon: IconBolt,
                label: coverage ? `${coverage.checkCount} security checks` : 'Security checks',
                desc: coverage
                  ? `${coverage.ruleCount} rules across ${coverage.coveredCount} of ${coverage.totalCount} OWASP categories`
                  : 'Loading coverage…',
              },
              { icon: IconGitBranch, label: 'Open source', desc: 'MIT License — free forever' },
              { icon: IconTerminal2, label: 'API-first', desc: 'REST API with Swagger docs' },
              {
                icon: IconShield,
                label: 'OWASP aligned',
                desc: coverage
                  ? `API Security Top 10 2023 — ${coverage.label} covered`
                  : 'API Security Top 10 2023',
              },
            ] as const
          ).map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
              <Icon className="mb-2 h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Stack" description={`Technologies powering ${appBrand.name}.`}>
        <ul className="flex flex-wrap gap-1.5">
          {STACK.map((tech) => (
            <li
              key={tech}
              className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            >
              {tech}
            </li>
          ))}
        </ul>
      </SettingsSection>
    </SettingsPanel>
  );
}
