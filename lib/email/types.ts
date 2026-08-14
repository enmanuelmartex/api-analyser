/**
 * The shapes the renderers share.
 *
 * In their own module rather than in `layout.ts` or `templates.ts` so that a
 * template can import a type without importing a renderer, which is what keeps
 * the template files from forming an import cycle through the barrel.
 */

export interface RenderedEmail {
  /** Chosen by this service, never by the caller. */
  readonly subject: string;
  readonly html: string;
  /** The plain-text alternative. Always present. */
  readonly text: string;
}

export interface SeverityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
}
