/**
 * The two palettes every template renders into.
 *
 * These are the product's own design tokens from `apps/web/src/app/globals.css`,
 * resolved from HSL to hex because an email cannot carry a CSS custom property:
 * `var(--primary)` is stripped by Gmail along with the `<style>` block that
 * defined it, so every colour has to arrive as a literal in an inline style.
 * Keeping the values traceable to that file is what stops the mail from slowly
 * drifting into a different-looking product.
 *
 * ── Why the server picks the variant, and the email does not ────────────────
 *
 * The obvious implementation is one template with a `prefers-color-scheme`
 * media query. It does not work: Gmail's web and mobile clients strip media
 * queries entirely, Outlook desktop never had them, and the clients that do
 * support them disagree about whether the query reflects the OS or the app.
 * So the recipient's stored preference is resolved in the API, sent as a
 * `theme` field, and this file turns it into a set of literals. One rendered
 * message, no client-side branching, identical in every inbox.
 *
 * `colorScheme` is still emitted as a `<meta>` and a body attribute. That is a
 * *defensive* signal rather than the mechanism: it tells Apple Mail and
 * Outlook.com "this message already handled dark mode, do not invert it",
 * which is what stops a carefully built dark email from being auto-inverted
 * into an unreadable grey one.
 */

export type ThemeName = 'light' | 'dark';

export interface ThemeTokens {
  /** Value for `<meta name="color-scheme">`, to suppress client auto-inversion. */
  readonly colorScheme: ThemeName;

  /** The page behind the message container. */
  readonly canvas: string;
  /** The message container itself. */
  readonly surface: string;
  /** Panels inside the container — the detail table, the metric tiles. */
  readonly card: string;
  /** Border on the container and on cards. */
  readonly hairline: string;

  /** Headings and figures. */
  readonly ink: string;
  /** Body prose. */
  readonly body: string;
  /** Labels, footer, secondary lines. */
  readonly muted: string;

  /** Filled button surface, and link text. */
  readonly accent: string;
  /** Text on top of `accent`. */
  readonly onAccent: string;

  /** Positive delta. */
  readonly positive: string;
  /** Negative delta, and the risk/danger states. */
  readonly negative: string;

  /** Risk and severity ramp. */
  readonly critical: string;
  readonly high: string;
  readonly medium: string;
  readonly low: string;
  readonly info: string;

  /** Tinted surface + border for the "scan failed" reason block. */
  readonly dangerSurface: string;
  readonly dangerHairline: string;

  /** Which logo file to reference. Resolved against the asset base URL. */
  readonly logoFile: string;
}

/**
 * Light.
 *
 * `accent` is the darkened brand blue (`--primary`, 212 90% 45%) rather than
 * the raw brand value (#2E8BF5). The same token has to work as a button surface
 * with white text AND as link text on white, and the raw brand blue passes
 * neither at 4.5:1.
 */
export const LIGHT: ThemeTokens = {
  colorScheme: 'light',

  canvas: '#fafafa',
  surface: '#ffffff',
  card: '#f7f7f8',
  hairline: '#dfdfe2',

  ink: '#0a0a0b',
  body: '#3f3f46',
  muted: '#62626a',

  accent: '#0b6cda',
  onAccent: '#ffffff',

  positive: '#1b7e3f',
  negative: '#b81e1e',

  critical: '#d52020',
  high: '#da5e0b',
  medium: '#ce8509',
  low: '#0f86bd',
  info: '#666670',

  dangerSurface: '#fef2f2',
  dangerHairline: '#f5c9c9',

  logoFile: 'mark-light.png',
};

/**
 * Dark.
 *
 * Not an inversion of the light palette, and deliberately not slate: the
 * product's dark mode is near-black (`--background: 240 11% 4%`), with the
 * container lifted one step off the canvas and cards lifted one step again, so
 * the three surfaces stay distinguishable without a single border being needed
 * to tell them apart.
 *
 * `onAccent` is near-black rather than white, matching `--primary-foreground`
 * in the dark theme: on a canvas this dark the blue is lifted to 62% lightness
 * so it clears 6:1 as link text, and white text on *that* blue is the
 * combination that fails.
 */
export const DARK: ThemeTokens = {
  colorScheme: 'dark',

  canvas: '#09090b',
  surface: '#131316',
  card: '#1f1f23',
  hairline: '#26262b',

  ink: '#fafafa',
  body: '#d4d4d8',
  muted: '#9f9fa8',

  accent: '#459bf7',
  onAccent: '#09090b',

  positive: '#22c35d',
  negative: '#f87171',

  critical: '#ef4343',
  high: '#f97415',
  medium: '#f59f0a',
  low: '#35b7f3',
  info: '#8f8f99',

  dangerSurface: '#231416',
  dangerHairline: '#4a2225',

  logoFile: 'mark-dark.png',
};

const THEMES: Record<ThemeName, ThemeTokens> = { light: LIGHT, dark: DARK };

/**
 * Resolves a theme name to its tokens.
 *
 * Defaults to light for anything unrecognised or absent. Light is the safe
 * fallback rather than dark for a specific reason: a light email rendered in a
 * client that force-inverts it is merely dark, while a dark email rendered in a
 * client that force-inverts *that* is a light email with white text on it.
 */
export function themeFor(name: ThemeName | undefined): ThemeTokens {
  return THEMES[name ?? 'light'] ?? LIGHT;
}

export const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Risk levels the scan summary can report, in ascending order. */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/** The colour a risk level is printed in, and how it is spelled for a reader. */
export function riskPresentation(
  theme: ThemeTokens,
  level: RiskLevel,
): { readonly colour: string; readonly label: string } {
  switch (level) {
    case 'CRITICAL':
      return { colour: theme.critical, label: 'Critical' };
    case 'HIGH':
      return { colour: theme.high, label: 'High' };
    case 'MEDIUM':
      return { colour: theme.medium, label: 'Medium' };
    case 'LOW':
      return { colour: theme.positive, label: 'Low' };
  }
}
