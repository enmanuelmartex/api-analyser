/**
 * The product's visible identity — the single source of truth for the API.
 *
 * Used by everything the server renders for a human: PDF and HTML reports,
 * the Swagger title and the console banner.
 *
 * SYNC CONTRACT: `apps/web/src/lib/brand.ts` holds the same values for the web
 * app. The two apps share no workspace package, so these constants are
 * duplicated deliberately; change both together. `brand.spec.ts` in each app
 * pins the canonical spelling so drift fails a test.
 *
 * NOTE ON "iasa": nothing. The identifier used to survive in infrastructure
 * contracts — the repo directory, the Postgres database name, seed account
 * emails, `IASA_*` CI secrets, the Docker image names — on the argument that
 * renaming them broke deployments for no user benefit. That argument expired
 * when the project was published: there were no deployments to break, and a
 * clone whose containers, database and package names all said `iasa` made the
 * old name look like the real one and the new one like a skin over it. The
 * rename went all the way down for v1.0. If you find `iasa` anywhere outside a
 * migration already applied to a database, it is a leftover, not a contract.
 *
 * MACHINE-READABLE FORMATS: SARIF's `tool.driver.name` and the JSON export's
 * `meta.tool` are consumed by external systems. They carry the new name because
 * they are presentational fields within a versioned schema, but the schema
 * shape itself is unchanged — no field was added or removed.
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

  /** Slug used to prefix downloaded report filenames. Lowercase, hyphenated. */
  fileSlug: 'api-analyser',

  /** User-Agent the scanner presents to a target under test. */
  scannerUserAgent: 'APIAnalyser-Scanner/1.0',

  /**
   * Header stamped on probe traffic, and the property name marking a probe
   * payload the target is meant to reject.
   *
   * Both are read by a stranger — the operator of the target, reading their own
   * logs during a scan — so they carry the product name rather than the legacy
   * internal one. Someone seeing repeated requests against their checkout
   * endpoint should be able to attribute them in seconds.
   */
  scannerProbeHeader: 'X-APIAnalyser-Probe',
  scannerProbeField: '__apianalyser_probe',

  /** Attribution on built-in scanner plugins. */
  pluginAuthor: 'API Analyser Core Team',
} as const;

/** Version of the report generator, stamped onto every artifact. */
export const REPORT_TOOL_VERSION = '1.0.0';
