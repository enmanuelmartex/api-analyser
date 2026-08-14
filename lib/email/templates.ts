import {
  renderCriticalFinding,
  type CriticalFindingData,
} from '@/lib/email/templates/critical-finding';
import { renderScanFailed, type ScanFailedData } from '@/lib/email/templates/scan-failed';
import { renderScanReport, type ScanReportData } from '@/lib/email/templates/scan-report';
import {
  renderWeeklySummary,
  type WeeklySummaryData,
} from '@/lib/email/templates/weekly-summary';
import type { ThemeName } from '@/lib/email/theme';
import type { RenderedEmail } from '@/lib/email/types';

export type { RenderedEmail, SeverityCounts } from '@/lib/email/types';
export type { ScanReportData } from '@/lib/email/templates/scan-report';
export type { ScanFailedData } from '@/lib/email/templates/scan-failed';
export type { CriticalFindingData } from '@/lib/email/templates/critical-finding';
export type { WeeklySummaryData, WeeklyMetric } from '@/lib/email/templates/weekly-summary';
export {
  renderScanReport,
  renderScanFailed,
  renderCriticalFinding,
  renderWeeklySummary,
};

/**
 * The complete set of messages this service is willing to send.
 *
 * ── The set being fixed IS the security model ───────────────────────────────
 *
 * A caller names one of these and supplies typed values for it. It cannot
 * supply markup, a subject, a sender, a header or a template of its own,
 * because there is no parameter through which any of those could arrive — not
 * because a filter rejects them. A relay that renders caller-controlled HTML
 * and sends it from a verified security domain is a phishing service with extra
 * steps, and the way not to become one is to have no code path that could.
 *
 * Adding a template means adding a member to this union, a branch below, and a
 * schema in `send.schema.ts`. All three are compile-time enforced: the
 * exhaustive switch fails to build if a member has no branch.
 */
export type TemplateInput =
  | {
      readonly template: 'scan-report';
      readonly data: ScanReportData;
      /** Set by the handler once the PDF has been decoded and named. */
      readonly attachedFilename?: string;
    }
  | { readonly template: 'scan-failed'; readonly data: ScanFailedData }
  | { readonly template: 'critical-finding'; readonly data: CriticalFindingData }
  | { readonly template: 'weekly-summary'; readonly data: WeeklySummaryData };

export type TemplateName = TemplateInput['template'];

export const TEMPLATE_NAMES = [
  'scan-report',
  'scan-failed',
  'critical-finding',
  'weekly-summary',
] as const;

export interface RenderOptions {
  /**
   * Which palette to render into.
   *
   * Resolved by the API from the recipient's stored preference before the
   * request is made — this service has no way to read a browser's
   * `localStorage`, and an email cannot ask. Absent means light; see
   * `themeFor` for why light rather than dark is the safe default.
   */
  readonly theme?: ThemeName;
  /** Absolute origin the logo is served from. From configuration, never a caller. */
  readonly assetBaseUrl: string;
}

/**
 * Renders one of the fixed messages.
 *
 * @throws never for a validated input. The default branch is unreachable by
 * construction and exists so that adding a template without a branch is a
 * compile error rather than a runtime surprise in production.
 */
export function renderTemplate(input: TemplateInput, options: RenderOptions): RenderedEmail {
  const { theme, assetBaseUrl } = options;

  switch (input.template) {
    case 'scan-report':
      return renderScanReport({
        data: input.data,
        theme,
        assetBaseUrl,
        attachedFilename: input.attachedFilename,
      });
    case 'scan-failed':
      return renderScanFailed({ data: input.data, theme, assetBaseUrl });
    case 'critical-finding':
      return renderCriticalFinding({ data: input.data, theme, assetBaseUrl });
    case 'weekly-summary':
      return renderWeeklySummary({ data: input.data, theme, assetBaseUrl });
    default: {
      const unreachable: never = input;
      throw new Error(`Unknown template: ${JSON.stringify(unreachable)}`);
    }
  }
}
