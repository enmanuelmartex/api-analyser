import type {
  AuditAction,
  LogCategory,
  LogSeverity,
  LogStatus,
} from '@prisma/client';

/**
 * One event as a producer describes it, before persistence.
 *
 * Everything except `event` and `category` is optional because the producers are
 * genuinely different: an HTTP handler knows a route and a duration, a worker
 * knows an assessment id and a stack trace, and neither should be forced to
 * invent the other's fields.
 */
export interface LogEventInput {
  /** Dotted name, e.g. `auth.login.failed`. The event's identity. */
  event: string;
  category: LogCategory;
  severity?: LogSeverity;
  status?: LogStatus;
  /** Coarse CRUD verb, when one honestly applies. */
  action?: AuditAction;

  /** Noun the event is about, e.g. `user`, `assessment`. Defaults to the event's first segment. */
  resource?: string;
  resourceId?: string;
  message?: string;

  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;

  httpMethod?: string;
  route?: string;
  statusCode?: number;
  requestId?: string;
  durationMs?: number;

  projectId?: string;
  assessmentId?: string;
  reportId?: string;

  metadata?: Record<string, unknown>;
  errorCode?: string;
  stackTrace?: string;
}

/**
 * Categories that are recorded even when log collection is switched off.
 *
 * Turning off collection is a volume control for routine application noise, not
 * a way to stop being audited. An administrator who could silence their own
 * authentication failures and configuration changes could cover their tracks,
 * which would make the audit trail worthless precisely when it matters. These
 * three categories are therefore always written, and the Log Management screen
 * says so next to the switch.
 */
export const ALWAYS_COLLECTED_CATEGORIES: readonly LogCategory[] = [
  'AUTHENTICATION',
  'SECURITY',
  'CONFIGURATION',
];

/** Severities that bypass the collection switch regardless of category. */
export const ALWAYS_COLLECTED_SEVERITIES: readonly LogSeverity[] = ['ERROR', 'CRITICAL'];

export function isAlwaysCollected(
  category: LogCategory,
  severity: LogSeverity,
): boolean {
  return (
    ALWAYS_COLLECTED_CATEGORIES.includes(category) ||
    ALWAYS_COLLECTED_SEVERITIES.includes(severity)
  );
}
