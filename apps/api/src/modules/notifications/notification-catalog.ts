import type { NotificationCategory, NotificationType, LogSeverity } from '@prisma/client';

/**
 * The one place that decides what a notification type *means*.
 *
 * Every other module asks this catalog rather than branching on the enum, which
 * is what keeps "add a notification type" to two edits — the Prisma enum and one
 * entry here — instead of a hunt through listeners, the preferences service and
 * the settings screen for the switch statements that each grew their own copy of
 * the mapping.
 *
 * The bug this replaces is worth naming: `COLUMN_FOR_TYPE` in the preferences
 * service listed six of the twelve types. `wants()` indexed it with the other
 * six, got `undefined`, and returned it — so every NEW_FINDINGS, REPORT_FAILED,
 * SCHEDULED_SCAN_* and EMAIL_* notification was silently discarded at the
 * preference gate. `Record<NotificationType, …>` below makes that specific
 * mistake a compile error: a type added to the enum without an entry here fails
 * the build.
 */

/** The in-app preference switches, one per user-facing event group. */
export interface InAppPreferenceFlags {
  scanCompleted: boolean;
  scanFailed: boolean;
  reportGenerated: boolean;
  reportFailed: boolean;
  securityWarning: boolean;
  criticalFinding: boolean;
  newFindings: boolean;
  systemError: boolean;
}

/**
 * The email switches, plus the master.
 *
 * Deliberately a smaller set than the in-app one. Email is interruptive and
 * cannot be marked read, so only outcomes somebody is waiting for, failures that
 * stop work, and critical vulnerabilities are offered. Routine findings stay
 * in-app — see `emailPreference: null` on NEW_FINDINGS below.
 */
export interface EmailPreferenceFlags {
  emailEnabled: boolean;
  emailScanCompleted: boolean;
  emailScanFailed: boolean;
  emailReportGenerated: boolean;
  emailCriticalFinding: boolean;
}

/** Presentation-only switches. Neither gates delivery; both shape arrival. */
export interface ExperiencePreferenceFlags {
  soundEnabled: boolean;
  desktopEnabled: boolean;
}

export type PreferenceFlags = InAppPreferenceFlags &
  EmailPreferenceFlags &
  ExperiencePreferenceFlags;

export interface NotificationDefinition {
  /** Which product area it badges. Drives the per-section sidebar counters. */
  category: NotificationCategory;
  /** Default severity, overridable per notification for counted events. */
  severity: LogSeverity;
  /** The in-app switch that gates it. */
  preference: keyof InAppPreferenceFlags;
  /**
   * The email switch that gates it, or null when the type is never emailed.
   *
   * Null is a hard rule, not a default: a type with no email preference cannot
   * be emailed even if a caller asks, because `mayEmail` below is the only way
   * the email pipeline decides.
   */
  emailPreference: keyof Omit<EmailPreferenceFlags, 'emailEnabled'> | null;
}

/**
 * Every notification type, defined once.
 *
 * `satisfies` rather than an annotation so the object keeps its literal types
 * for callers while still being checked for exhaustiveness against the enum.
 */
export const NOTIFICATION_CATALOG = {
  SCAN_COMPLETED: {
    category: 'SCANS',
    severity: 'INFO',
    preference: 'scanCompleted',
    emailPreference: 'emailScanCompleted',
  },
  SCAN_FAILED: {
    category: 'SCANS',
    severity: 'ERROR',
    preference: 'scanFailed',
    emailPreference: 'emailScanFailed',
  },
  SCHEDULED_SCAN_COMPLETED: {
    category: 'SCANS',
    severity: 'INFO',
    preference: 'scanCompleted',
    emailPreference: 'emailScanCompleted',
  },
  SCHEDULED_SCAN_FAILED: {
    category: 'SCANS',
    severity: 'ERROR',
    preference: 'scanFailed',
    emailPreference: 'emailScanFailed',
  },
  REPORT_GENERATED: {
    category: 'REPORTS',
    severity: 'INFO',
    preference: 'reportGenerated',
    emailPreference: 'emailReportGenerated',
  },
  REPORT_FAILED: {
    category: 'REPORTS',
    severity: 'ERROR',
    preference: 'reportFailed',
    // Not emailed. A report that failed to generate is retried automatically and
    // usually succeeds; mailing about the intermediate failure would announce a
    // problem the user cannot act on and that may already be resolved.
    emailPreference: null,
  },
  NEW_FINDINGS: {
    category: 'ISSUES',
    severity: 'WARNING',
    preference: 'newFindings',
    // In-app only, by design: the scan-completed email already carries the
    // severity breakdown, so emailing this too would be the same news twice.
    emailPreference: null,
  },
  CRITICAL_FINDING: {
    category: 'ISSUES',
    severity: 'CRITICAL',
    preference: 'criticalFinding',
    emailPreference: 'emailCriticalFinding',
  },
  EMAIL_REPORT_SENT: {
    category: 'REPORTS',
    severity: 'INFO',
    preference: 'reportGenerated',
    // Never emailed — mailing to confirm a mail is a loop with no exit.
    emailPreference: null,
  },
  EMAIL_REPORT_FAILED: {
    category: 'REPORTS',
    severity: 'WARNING',
    preference: 'reportFailed',
    // Never emailed, and for the same reason plus a stronger one: the delivery
    // channel is the thing that just failed.
    emailPreference: null,
  },
  SECURITY_WARNING: {
    category: 'SECURITY',
    severity: 'WARNING',
    preference: 'securityWarning',
    emailPreference: null,
  },
  SYSTEM_ERROR: {
    category: 'SYSTEM',
    severity: 'ERROR',
    preference: 'systemError',
    emailPreference: null,
  },
} satisfies Record<NotificationType, NotificationDefinition>;

/** The definition for a type. Total by construction — no undefined result. */
export function definitionFor(type: NotificationType): NotificationDefinition {
  return NOTIFICATION_CATALOG[type];
}

/**
 * Defaults for a user who has never opened the settings screen.
 *
 * Every in-app event is on: a new user should receive the notifications the
 * product exists to deliver. `emailEnabled` is off because a self-hosted install
 * has no mail provider until somebody configures one, and defaulting it on would
 * queue deliveries that can only fail. Sound and desktop are off because neither
 * should start happening because of a default the user never chose.
 *
 * Kept in step with the column defaults in `schema.prisma`; the preferences
 * spec asserts the two agree.
 */
export const DEFAULT_PREFERENCES: PreferenceFlags = {
  scanCompleted: true,
  scanFailed: true,
  reportGenerated: true,
  reportFailed: true,
  securityWarning: true,
  criticalFinding: true,
  newFindings: true,
  systemError: true,

  emailEnabled: false,
  emailScanCompleted: true,
  emailScanFailed: true,
  emailReportGenerated: true,
  emailCriticalFinding: true,

  soundEnabled: false,
  desktopEnabled: false,
};

/** Every preference key, for validation and for the settings screen's form. */
export const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof PreferenceFlags)[];

/**
 * Which categories badge which section of the navigation.
 *
 * The sidebar shows a count per destination, not per category, and the two are
 * not one-to-one — a critical finding belongs to ISSUES for badging while a
 * failed login belongs to SECURITY, which has no sidebar entry of its own and
 * folds into the bell's total only.
 */
export const SECTION_CATEGORIES = {
  scans: ['SCANS'],
  issues: ['ISSUES'],
  reports: ['REPORTS'],
} satisfies Record<string, NotificationCategory[]>;

export type NotificationSection = keyof typeof SECTION_CATEGORIES;
