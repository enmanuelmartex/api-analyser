/**
 * The product's visible identity — the single source of truth for the web app.
 *
 * Every user-facing occurrence of the product name, domain or logo path must
 * read from here. Before this module the string "IASA" was hardcoded in
 * fourteen components, so a rename meant hunting through JSX and inevitably
 * missing a toast or an aria-label.
 *
 * SYNC CONTRACT: `apps/api/src/brand/brand.ts` holds the same values for
 * server-rendered artifacts (PDF/HTML reports, invitation emails, Swagger).
 * The two apps have no shared workspace package, so the constants are
 * duplicated deliberately; change both together. `brand.spec.ts` in each app
 * pins the canonical spelling so a drift fails a test rather than shipping.
 *
 * NOTE ON "iasa": the identifier survives in internal, non-visible places —
 * the repository directory, the Postgres database name, seed account emails,
 * `IASA_*` CI secrets and the Docker image name. Those are infrastructure
 * contracts, not branding; renaming them would break deployments for no user
 * benefit. See the task report for the full inventory.
 */

export const appBrand = {
  /** Canonical product name. "API" uppercase, "Analyser" with an s. */
  name: 'API Analyser',
  shortName: 'API Analyser',
  domain: 'apianalyser.com',
  url: 'https://apianalyser.com',
  tagline: 'Automated API Security Assessment',
  description:
    'Automated API security assessment and vulnerability analysis. Scan REST APIs against the OWASP API Security Top 10.',

  /**
   * Brand assets.
   *
   * There is deliberately ONE symbol file. It paints with `currentColor`, so
   * the same asset serves dark and light surfaces by inheriting text colour —
   * no `-dark`/`-light` pair to drift apart. The "full" lockup (symbol + name)
   * is composed by `<AppLogo variant="full">` rather than duplicated as a
   * second file, so the wordmark can never disagree with `appBrand.name`.
   *
   * The favicon is `src/app/icon.svg` via Next's file convention — the same
   * artwork, picked up automatically for the browser tab.
   */
  logos: {
    icon: '/brand/api-analyser-icon.svg',
  },
} as const;

/** Browser tab title for a section, e.g. "Reports | API Analyser". */
export function pageTitle(section?: string): string {
  return section ? `${section} | ${appBrand.name}` : `${appBrand.name} — ${appBrand.tagline}`;
}
