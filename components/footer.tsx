import { BrandLogo } from '@/components/brand-logo';
import { GitHubIcon } from '@/components/icons';
import { brand, navLinks, repo } from '@/lib/site';

/**
 * The footer, and the only place the old name is explained.
 *
 * `IASA` is still all over the repository — the directory, the database, the
 * Docker images, the `IASA_*` CI secrets — because renaming infrastructure
 * contracts breaks deployments for no user benefit. Someone who clones this
 * expecting "API Analyser" and finds `iasa` everywhere deserves the one-line
 * explanation before they open an issue about it.
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
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <BrandLogo type="horizontal" size={34} />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-zinc-500">{brand.description}</p>
            <a
              href={repo.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <GitHubIcon className="h-4 w-4" />
              {repo.owner}/{repo.name}
            </a>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-sm font-medium text-zinc-200">{column.heading}</h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                      className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
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
            Formerly <span className="text-zinc-500">{brand.legacyName}</span>. The identifier
            survives in the repository directory, the database and the CI secrets — renaming those
            would break deployments for no user benefit.
          </p>
        </div>
      </div>
    </footer>
  );
}
