/**
 * The provider boundary.
 *
 * `EmailService` owns idempotency, delivery records and redaction; a transport
 * owns nothing but "get these bytes to this address". Splitting them is what
 * lets a self-hosted install choose between holding its own Resend key and
 * delegating to the hosted relay without either choice reaching the scan,
 * report or issue services.
 */

export interface MessageAttachment {
  filename: string;
  content: Buffer;
}

/**
 * The typed payload a rendering transport needs.
 *
 * The relay does not accept HTML — it renders its own templates from values,
 * which is what stops a leaked relay token from becoming a way to send branded
 * mail from `notifications.apianalyser.com` saying anything at all. So a
 * message that must be able to travel that way carries both forms: the HTML
 * this app rendered, for the direct-to-Resend transport, and the values the
 * relay renders from.
 *
 * Keep the two saying the same thing. A message with no `relay` payload simply
 * cannot be sent through the relay, and is recorded as SKIPPED with that
 * reason rather than being silently dropped or sent looking wrong.
 */
export type RelayPayload =
  | {
      template: 'scan-report';
      data: {
        userName?: string;
        projectName: string;
        securityScore?: number | null;
        riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        counts?: {
          critical: number;
          high: number;
          medium: number;
          low: number;
          info: number;
        };
        totalFindings?: number;
        endpointsEvaluated?: number;
        /** Calendar date in the recipient's zone, `YYYY-MM-DD`. Never an instant. */
        scanDate?: string;
        reportUrl?: string;
      };
    }
  | {
      template: 'scan-failed';
      data: {
        userName?: string;
        projectName: string;
        reason: string;
        scanUrl?: string;
        scheduleName?: string;
      };
    }
  | {
      template: 'critical-finding';
      data: {
        userName?: string;
        projectName: string;
        criticalCount: number;
        issuesUrl?: string;
      };
    }
  | {
      template: 'weekly-summary';
      data: {
        userName?: string;
        /** Monday of the reported week, `YYYY-MM-DD` in the recipient's zone. */
        dateFrom: string;
        /** Sunday, inclusive. */
        dateTo: string;
        assessments: WeeklyMetricPayload;
        findings: WeeklyMetricPayload;
        critical: WeeklyMetricPayload;
        activeProjects: number;
        dashboardUrl?: string;
      };
    };

/**
 * One figure and its week-over-week change.
 *
 * `changePercent` is nullable and NOT optional. The relay's schema requires the
 * key to be present, so "there was no previous week to compare against" has to
 * be stated rather than implied by omission — which is what stops a forgotten
 * field from being rendered as "no change".
 */
export interface WeeklyMetricPayload {
  count: number;
  changePercent: number | null;
}

/**
 * Which palette the relay should render into.
 *
 * Resolved from the recipient's stored preference before the request is made.
 * `system` is never sent: the relay has no OS to consult, so the API collapses
 * it to a concrete value — see `resolveEmailTheme`.
 */
export type RelayTheme = 'light' | 'dark';

export interface OutboundMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MessageAttachment[];
  /** Present on every message that is allowed to travel through the relay. */
  relay?: RelayPayload;
  /**
   * Which variant the relay should render.
   *
   * Only meaningful for the relay: the direct-to-Resend transport renders its
   * own HTML locally and has one variant. Absent means light.
   */
  theme?: RelayTheme;
}

export interface TransportSuccess {
  ok: true;
  providerMessageId?: string;
}

/**
 * `reason` is already redacted by the transport and is safe to store on a
 * delivery row and to log. `retryable` distinguishes an outage from a
 * rejection, so a queue can tell "try again" from "this will never work".
 */
export interface TransportFailure {
  ok: false;
  reason: string;
  retryable: boolean;
}

export type TransportResult = TransportSuccess | TransportFailure;

/**
 * Narrows a result to its failure branch.
 *
 * A predicate rather than `if (!result.ok)`, because this app compiles with
 * `strictNullChecks: false`, under which TypeScript does not narrow a
 * discriminated union by its discriminant. Without this the union would have to
 * be flattened into one interface with everything optional, which is exactly
 * the shape that lets a caller read `reason` off a success.
 */
export function isTransportFailure(result: TransportResult): result is TransportFailure {
  return result.ok === false;
}

export interface MailTransport {
  /** For logs and for the delivery row. */
  readonly name: string;
  /** Whether this transport has everything it needs to send. */
  isConfigured(): boolean;
  /** Never throws: every outcome is a returned value. */
  send(message: OutboundMessage): Promise<TransportResult>;
}
