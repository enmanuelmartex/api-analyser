/**
 * The catalogue of runtime-adjustable settings.
 *
 * One entry per setting, and nothing outside this file may invent a key: the
 * registry is what makes `PATCH /settings` safe to expose. A request naming a
 * key that is not here is rejected, so the endpoint cannot be used to write
 * arbitrary rows into `system_settings`, and every value is range-checked
 * against the same definition the UI renders from.
 *
 * Resolution order is DB → env → `fallback`. The env variable is the operator's
 * default for a fresh install; the DB row is an administrator overriding it at
 * runtime without a redeploy. Deleting the row restores the env value, which is
 * what makes "reset to default" meaningful.
 *
 * Secrets are deliberately absent. Nothing here is a credential, so the whole
 * catalogue can be returned to an admin UI and written to an audit event
 * without a redaction pass.
 */

export type SettingKind = 'boolean' | 'number';

export interface SettingDefinition {
  /** Dotted key, also the primary key in `system_settings`. */
  key: string;
  kind: SettingKind;
  /** Environment variable consulted when no DB row exists. */
  env: string;
  /** Last resort when neither the DB nor the environment has a value. */
  fallback: boolean | number;
  label: string;
  description: string;
  /** Inclusive bounds for `kind: 'number'`. Rejected outside these. */
  min?: number;
  max?: number;
  /** Which UI block the setting belongs to. */
  group: 'logs' | 'notifications' | 'scanner' | 'reports';
}

export const SETTING_DEFINITIONS = [
  // ── Logs ───────────────────────────────────────────────────────────────────
  {
    key: 'logs.collectionEnabled',
    kind: 'boolean',
    env: 'LOG_COLLECTION_ENABLED',
    fallback: true,
    label: 'Log collection',
    description:
      'Capture application events. Security, authentication and administrative events are always recorded regardless of this setting.',
    group: 'logs',
  },
  {
    key: 'logs.liveStreamEnabled',
    kind: 'boolean',
    env: 'LOG_LIVE_STREAM_ENABLED',
    fallback: true,
    label: 'Live streaming',
    description: 'Allow administrators to subscribe to the real-time event stream.',
    group: 'logs',
  },
  {
    key: 'logs.retentionEnabled',
    kind: 'boolean',
    env: 'LOG_RETENTION_ENABLED',
    fallback: true,
    label: 'Automatic cleanup',
    description: 'Delete events that exceed the retention policy on a schedule.',
    group: 'logs',
  },
  {
    key: 'logs.retentionDays',
    kind: 'number',
    env: 'LOG_RETENTION_DAYS',
    fallback: 30,
    min: 1,
    max: 3650,
    label: 'Retention period',
    description: 'Events older than this are deleted by the cleanup job.',
    group: 'logs',
  },
  {
    key: 'logs.maxRecords',
    kind: 'number',
    env: 'LOG_MAX_RECORDS',
    fallback: 500_000,
    min: 1_000,
    max: 100_000_000,
    label: 'Maximum stored events',
    description:
      'Hard ceiling on the table. When exceeded, the oldest events are deleted first.',
    group: 'logs',
  },
  {
    key: 'logs.cleanupIntervalHours',
    kind: 'number',
    env: 'LOG_CLEANUP_INTERVAL_HOURS',
    fallback: 24,
    min: 1,
    max: 720,
    label: 'Cleanup frequency',
    description: 'How often the retention job runs.',
    group: 'logs',
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  {
    key: 'notifications.enabled',
    kind: 'boolean',
    env: 'NOTIFICATIONS_ENABLED',
    fallback: true,
    label: 'In-app notifications',
    description:
      'Master switch. When off, no notification is created for any user regardless of their own preferences.',
    group: 'notifications',
  },
  {
    key: 'notifications.retentionDays',
    kind: 'number',
    env: 'NOTIFICATIONS_RETENTION_DAYS',
    fallback: 90,
    min: 1,
    max: 3650,
    label: 'Notification retention',
    description: 'Read notifications older than this are removed by the cleanup job.',
    group: 'notifications',
  },

  // ── Scanner ────────────────────────────────────────────────────────────────
  // These mirror existing env-configured scanner limits so an operator can
  // adjust them without a redeploy. The scanner reads them through
  // SettingsService, so the env value remains the default.
  {
    key: 'scanner.maxConcurrentScans',
    kind: 'number',
    env: 'MAX_CONCURRENT_SCANS',
    fallback: 3,
    min: 1,
    max: 50,
    label: 'Concurrent scans',
    description: 'How many assessments the worker runs at the same time.',
    group: 'scanner',
  },
  {
    key: 'scanner.scanTimeoutMs',
    kind: 'number',
    env: 'SCAN_TIMEOUT_MS',
    fallback: 300_000,
    min: 10_000,
    max: 3_600_000,
    label: 'Scan timeout',
    description: 'A scan exceeding this is marked failed.',
    group: 'scanner',
  },
  {
    key: 'scanner.maxRequestsPerEndpoint',
    kind: 'number',
    env: 'MAX_REQUESTS_PER_ENDPOINT',
    fallback: 10,
    min: 1,
    max: 500,
    label: 'Requests per endpoint',
    description: 'Upper bound on probes a single check may send to one endpoint.',
    group: 'scanner',
  },
  {
    key: 'scanner.requestDelayMs',
    kind: 'number',
    env: 'REQUEST_DELAY_MS',
    fallback: 100,
    min: 0,
    max: 10_000,
    label: 'Request delay',
    description: 'Pause between probes, to stay within the target API rate limits.',
    group: 'scanner',
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]['key'];

const BY_KEY = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}
