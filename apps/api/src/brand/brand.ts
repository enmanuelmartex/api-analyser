/**
 * The product's visible identity — the single source of truth for the API.
 *
 * Used by everything the server renders for a human: PDF and HTML reports,
 * invitation emails, the Swagger title and the console banner.
 *
 * SYNC CONTRACT: `apps/web/src/lib/brand.ts` holds the same values for the web
 * app. The two apps share no workspace package, so these constants are
 * duplicated deliberately; change both together. `brand.spec.ts` in each app
 * pins the canonical spelling so drift fails a test.
 *
 * NOTE ON "iasa": the identifier survives in internal, non-visible places — the
 * repo directory, the Postgres database name, seed account emails, `IASA_*` CI
 * secrets and the Docker image name. Those are infrastructure contracts, not
 * branding, and renaming them would break deployments for no user benefit.
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

  /** Attribution on built-in scanner plugins. */
  pluginAuthor: 'API Analyser Core Team',
} as const;

/** Version of the report generator, stamped onto every artifact. */
export const REPORT_TOOL_VERSION = '1.0.0';
