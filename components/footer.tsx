import { BrandLogo } from '@/components/brand-logo';
import { GitHubIcon } from '@/components/icons';
import { brand, navLinks, repo } from '@/lib/site';

/**
 * The footer, and the only place the old name is explained.
 *
 * The project shipped as `IASA` before v1.0 and the rename went all the way
 * down — repository, packages, containers, database, CI secrets. Anyone
 * arriving from a paper, a bookmark or an old clone is looking for a name that
 * no longer exists anywhere, so the mapping is stated once, here, rather than
 * left for them to infer.
 */

const COLUMNS = [
  {
    heading: 'Project',
    links: [
      { label: 'Repository', href: repo.url, external: true },
      { label: 'README', href: repo.readmeUrl, external: true },
      { label: 'Architecture', href: repo.architectureUrl, external: true },
      { label: 'Releases', href: repo.releasesUrl, external: true },
    ],
  },
  {
    heading: 'This page',
    links: navLinks.map((link) => ({ label: link.label, href: link.href, external: false })),
  },
  {
    heading: 'Reference',
    links: [
      {
        label: 'OWASP API Top 10',
        href: 'https://owasp.org/API-Security/editions/2023/en/0x11-t10/',
        external: true,
      },
      { label: 'SARIF', href: 'https://sarifweb.azurewebsites.net/', external: true },
      { label: 'Report an issue', href: repo.issuesUrl, external: true },
      { label: 'MIT licence', href: repo.licenseUrl, external: true },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-zinc-800/80 bg-brand-canvas">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-6">
        {/* Three link columns stacked into one on a phone made the footer four
            screens tall on its own. They pair up first, then spread out. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <BrandLogo type="horizontal" size={34} />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-zinc-500">{brand.description}</p>
            <a
              href={repo.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <GitHubIcon className="h-4 w-4" />
              {repo.owner}/{repo.name}
            </a>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-sm font-medium text-zinc-200">{column.heading}</h2>
              <ul className="mt-2 space-y-0.5 sm:mt-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                      className="flex min-h-10 items-center text-sm text-zinc-500 transition-colors hover:text-zinc-200"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-zinc-800/60 pt-8 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 Enmanuel Enrique Marte Cuevas · MIT licensed · University cybersecurity capstone
            project
          </p>
          <p className="max-w-md sm:text-right">
            Formerly <span className="text-zinc-500">{brand.legacyName}</span> — renamed throughout
            for v1.0. Old clone URLs still resolve through GitHub&apos;s redirect, but the
            identifier is gone from the code.
          </p>
        </div>
      </div>
    </footer>
  );
}
