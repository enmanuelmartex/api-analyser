export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'ANALYST' | 'VIEWER';
  avatar?: string;
  isActive?: boolean;
  lastLogin?: string;
  createdAt: string;
}

export type AuditActionType =
  | 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
  | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT'
  | 'SCAN_START' | 'SCAN_STOP' | 'ROLE_CHANGE' | 'PASSWORD_RESET';

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'ANALYST' | 'VIEWER';
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { projects: number };
}

export interface AuditLog {
  id: string;
  userId?: string;
  user?: { id: string; name: string; email: string };
  action: AuditActionType;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  environment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  tags: string[];
  isActive: boolean;
  status: 'DRAFT' | 'READY';
  setupStep: number;
  completedAt?: string;
  userId: string;
  apiSpec?: ApiSpec;
  assessments?: Assessment[];
  _count?: { assessments: number };
  createdAt: string;
  updatedAt: string;
}

export interface ApiSpec {
  id: string;
  projectId: string;
  source: 'URL' | 'UPLOAD' | 'MANUAL';
  url?: string;
  title?: string;
  version?: string;
  endpoints?: Endpoint[];
  authConfig?: AuthConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AuthConfig {
  id: string;
  type: 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY' | 'OAUTH2' | 'CUSTOM';
  apiKeyHeader?: string;
  apiKeyLocation?: string;
  tokenUrl?: string;
  scopes?: string[];
}

export interface Endpoint {
  id: string;
  path: string;
  method: string;
  summary?: string;
  tags?: string[];
  deprecated?: boolean;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
/**
 * Triage state of a persistent vulnerability. Mirrors the Prisma IssueStatus
 * enum. `ACKNOWLEDGED` replaced the old `CONFIRMED`.
 */
export type IssueStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'ACCEPTED_RISK'
  | 'FALSE_POSITIVE';

/** Statuses whose transition must carry a reason, for the audit trail. */
export const ISSUE_STATUSES_REQUIRING_REASON: IssueStatus[] = [
  'RESOLVED',
  'ACCEPTED_RISK',
  'FALSE_POSITIVE',
];

/** A vulnerability that persists across scans. */
export interface SecurityIssue {
  id: string;
  projectId: string;
  fingerprint: string;
  fingerprintVersion: string;
  pluginId: string;
  ruleId: string;
  method: string;
  normalizedRoute: string;
  component: string;
  title: string;
  description: string;
  severity: Severity;
  owaspCategory: string;
  cweId?: string | null;
  cvssScore?: number | null;
  status: IssueStatus;
  notes?: string | null;
  assigneeId?: string | null;
  acceptedRiskUntil?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string | null;
  reopenedAt?: string | null;
  reopenCount: number;
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string; email: string } | null;
  occurrences?: FindingOccurrence[];
  statusChanges?: IssueStatusChange[];
}

/** One immutable detection of an issue by one scan. */
export interface FindingOccurrence {
  id: string;
  issueId: string;
  assessmentId: string;
  endpointId?: string | null;
  titleSnapshot: string;
  descriptionSnapshot: string;
  severitySnapshot: Severity;
  owaspSnapshot: string;
  cweSnapshot?: string | null;
  cvssSnapshot?: number | null;
  methodSnapshot: string;
  pathSnapshot: string;
  ruleIdSnapshot: string;
  pluginIdSnapshot: string;
  pluginVersionSnapshot: string;
  impactSnapshot?: string | null;
  remediationSnapshot?: string | null;
  evidence?: unknown;
  httpRequest?: string | null;
  httpResponse?: string | null;
  affectedUrl?: string | null;
  location: string;
  detectedAt: string;
  assessment?: { id: string; createdAt: string; status: string };
  issue?: Pick<SecurityIssue, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt' | 'occurrenceCount'>;
}

/** One entry in an issue's auditable triage history. */
export interface IssueStatusChange {
  id: string;
  issueId: string;
  fromStatus?: IssueStatus | null;
  toStatus: IssueStatus;
  actorId?: string | null;
  assessmentId?: string | null;
  reason?: string | null;
  automatic: boolean;
  acceptedRiskUntil?: string | null;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}

/** Standard envelope for paginated list endpoints. */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export type AssessmentStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Assessment {
  id: string;
  projectId: string;
  project?: { id: string; name: string; baseUrl: string; environment?: string };
  status: AssessmentStatus;
  progress: number;
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  jobId?: string;
  config?: AssessmentConfig;
  summary?: AssessmentSummary;
  /** Detections this scan produced, each linked to its persistent issue. */
  occurrences?: FindingOccurrence[];
  reports?: Report[];
  logs?: AssessmentLog[];
  _count?: { occurrences: number };
  /**
   * Finding counts derived from this scan's real occurrences (source of truth
   * for the Critical / High / Total columns), attached by the list, paginated
   * and dashboard endpoints. `total` includes every severity. Absent on the
   * single-assessment detail endpoint, which loads the occurrences themselves.
   */
  findingCounts?: FindingCounts;
  createdAt: string;
  updatedAt: string;
}

/** Occurrence-derived severity counts for one assessment. `total` = all severities. */
export interface FindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export interface AssessmentConfig {
  executionMode: 'all' | 'profile' | 'manual';
  scanProfileId?: string;
  manualPlugins?: string[];
  resolvedPlugins?: string[];
  enableAiAnalysis: boolean;
  maxRequestsPerEndpoint: number;
  requestDelayMs: number;
  timeoutMs: number;
}

export interface AssessmentSummary {
  totalEndpoints: number;
  testedEndpoints: number;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  /**
   * Null when no score could be computed. Always read together with
   * `scoreStatus`: a score without its status can misrepresent a partial or
   * failed run as a real result.
   */
  securityScore: number | null;
  scoreStatus: 'UNAVAILABLE' | 'PROVISIONAL' | 'FINAL';
  scoreVersion?: string | null;
  scoreComputedAt?: string | null;
  plannedChecks?: number;
  successfulChecks?: number;
  failedChecks?: number;
  skippedChecks?: number;
  executionErrors?: number;
  coveragePercent?: number | null;
  riskLevel: string;
  owaspCoverage?: Record<string, number>;
  /** Plugin execution plan — which ran, which were skipped, timing, finding counts */
  pluginResults?: PluginExecutionPlan;
  /** AI analysis metadata — provider, model, findings analyzed, reason if skipped */
  aiStatus?: AiAnalysisMeta;
}

export interface PluginExecutionPlan {
  available:     string[];
  executed:      string[];
  /** Attempted but did not complete. Never treated as "ran successfully". */
  failed:        string[];
  skipped:       string[];
  skippedReason: Record<string, string>;
  versions:      Record<string, string>;
  durationMs:    Record<string, number>;
  findingCounts: Record<string, number>;
}

export interface AiAnalysisMeta {
  provider:      string;
  model:         string;
  available:     boolean;
  analyzed:      number;
  skipped:       number;
  durationMs:    number;
  tokensUsed:    number;
  reason?:       string;
  /** completed = ran successfully; skipped = disabled / no provider; failed = provider error */
  status?:       'completed' | 'skipped' | 'failed';
  /** Provider error detail when status === 'failed' */
  errorMessage?: string;
}

export interface AiProviderStatus {
  provider:  string;
  model:     string;
  available: boolean;
  reason?:   string;
}

export type AiProfile = 'minimal' | 'balanced' | 'complete' | 'custom';

/** Per-provider config row from the API. One row exists per configured provider. */
export interface AiProviderConfig {
  provider:         string;
  model:            string;
  maskedKey?:       string;
  hasKey:           boolean;
  baseUrl?:         string;
  isActive:         boolean;
  profile:          AiProfile;
  analyzeCritical:  boolean;
  analyzeHigh:      boolean;
  analyzeMedium:    boolean;
  analyzeLow:       boolean;
  executiveSummary: boolean;
  maxTokens:        number;
  temperature:      number;
  timeoutMs:        number;
  maxFindings:      number;
  retryAttempts:    number;
  configSource:     'database' | 'environment' | 'defaults';
  lastTestedAt?:    string;
  lastTestSuccess?: boolean;
  lastTestMessage?: string;
  configuredAt?:    string;
  envHasKey:        boolean;
  envModel?:        string;
}

export interface AiEnvStatus {
  openai:  { apiKey: boolean; model: string };
  grok:    { apiKey: boolean; model: string };
  claude:  { apiKey: boolean; model: string };
  gemini:  { apiKey: boolean; model: string };
  ollama:  { baseUrl: string; model: string };
  activeProvider: string;
}

export interface AiTestConnectionResult {
  success:    boolean;
  message:    string;
  latencyMs?: number;
  model?:     string;
}

// The legacy `Finding` interface was removed in Phase 1C. A detection is now
// a `FindingOccurrence` and a vulnerability is a `SecurityIssue`; the old type
// conflated the two, which is why the same problem appeared once per scan.

export type ReportType = 'EXECUTIVE' | 'TECHNICAL' | 'COMPLIANCE' | 'DEVELOPER';
export type ReportFormat = 'PDF' | 'HTML' | 'MARKDOWN' | 'JSON' | 'SARIF';

export const REPORT_FORMATS: ReportFormat[] = ['PDF', 'HTML', 'MARKDOWN', 'JSON', 'SARIF'];

export interface Report {
  id: string;
  assessmentId: string;
  assessment?: {
    id: string;
    status?: string;
    completedAt?: string | null;
    duration?: number | null;
    project: { id: string; name: string };
    summary?: AssessmentSummary;
    occurrences?: FindingOccurrence[];
  };
  type: ReportType;
  format: ReportFormat;
  title: string;
  /** Explicit revision of (assessment, type, format). Only "Regenerate" increments it. */
  version: number;
  /** Server-derived download name. The client never chooses it. */
  fileName?: string | null;
  filePath?: string | null;
  fileSize?: number | null;
  checksum?: string | null;
  generatorVersion?: string | null;
  /**
   * Whether an artifact actually exists behind this row. False for records
   * created before artifacts were persisted — those offer "Generate", not
   * "Download".
   */
  isDownloadable: boolean;
  generatedAt: string;
  /** Present on report detail: every format of this assessment + type. */
  formats?: ReportFormatAvailability[];
}

/**
 * One format of a report bundle.
 *
 * `AVAILABLE` → downloadable now. `UNAVAILABLE` → the row exists but has no
 * artifact. `MISSING` → never generated. The UI must never label the last two
 * "Download".
 */
export interface ReportFormatAvailability {
  format: ReportFormat;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'MISSING';
  reportId: string | null;
  fileSize: number | null;
  generatedAt: string | null;
  version: number | null;
}

export interface ReportTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  /** Scans completed that day. 0 means no scan ran — not "a scan found nothing". */
  scans: number;
}

/** Half-window comparison of the vulnerability trend. Null when there is no baseline. */
export interface ReportTrendDelta {
  current: number;
  previous: number;
  /** Negative means fewer vulnerabilities, which is an improvement. */
  changePercent: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Change in average security score between two consecutive 30-day windows.
 *
 * Null when either window holds no scored assessment — a first-ever scan has no
 * baseline, and the UI says so rather than showing a fabricated delta.
 */
export interface ReportScoreDelta {
  currentAverage: number;
  previousAverage: number;
  /** Signed whole points. Positive means the posture improved. */
  deltaPoints: number;
  /** Null when the previous average was 0 — no honest percentage exists. */
  deltaPercent: number | null;
  direction: 'up' | 'down' | 'flat';
  currentSampleSize: number;
  previousSampleSize: number;
}

/**
 * Reports metrics.
 *
 * Field names state their unit. Everything is scoped to assessments that
 * produced at least one ACTIVE report, and distinct entities are counted once —
 * never multiplied by the number of formats a scan was exported to.
 *
 * "Artifact" = one row = one (assessment, type, format). "Active" = the latest
 * version of that artifact; superseded rows are earlier versions.
 */
export interface ReportStats {
  activeReportArtifacts: number;
  supersededReportArtifacts: number;
  activeArtifactsLast30Days: number;

  distinctAssessmentsWithReports: number;
  /** All COMPLETED assessments — the denominator shown on the Assessments page. */
  totalCompletedAssessments: number;
  distinctProjectsCovered: number;
  totalActiveProjects: number;

  /** One value per assessment, all time. Null when nothing was scored. */
  averageAssessmentScore: number | null;
  scoredAssessmentsInAverage: number;
  averageScoreDelta: ReportScoreDelta | null;

  criticalFindingsIncluded: number;
  highFindingsIncluded: number;
  mediumFindingsIncluded: number;
  lowFindingsIncluded: number;
  infoFindingsIncluded: number;
  totalFindingsIncluded: number;
  criticalHighFindingsIncluded: number;

  /** Per-day, per-severity independent counts. Never cumulative. */
  vulnerabilityTrend: ReportTrendPoint[];
  vulnerabilityTrendDelta: ReportTrendDelta | null;
  trendWindowDays: number;
}

export interface AssessmentLog {
  id: string;
  level: string;
  plugin?: string;
  message: string;
  timestamp: string;
}

/** One calendar month (Jan–Dec of the current year) in the dashboard's security-score evolution. */
export interface ScoreTrendPoint {
  /** Calendar month key, `YYYY-MM`. */
  month: string;
  /** Average security score of the assessments completed that month; `null` when none produced a score (distinct from a real 0). */
  averageScore: number | null;
  /** Number of assessments completed in that month. */
  completedCount: number;
}

/** One 7-day bucket in the dashboard's eight-week findings-by-severity trend. */
export interface WeeklyFindingsPoint {
  /** ISO date marking the start of the 7-day bucket. */
  weekStart: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface DashboardStats {
  totalProjects: number;
  totalAssessments: number;
  /** Null when no project has a computable score. Never substitute 0 or 100. */
  avgSecurityScore: number | null;
  scoredProjects?: number;
  unassessedProjects?: number;
  findings: Record<string, number>;
  recentAssessments: Assessment[];
  /** Current calendar year (Jan–Dec) evolution of the average security score. */
  scoreTrend: ScoreTrendPoint[];
  /** Mean score across every scored assessment completed this calendar year; null when none. */
  scoreTrendAverage: number | null;
  /** Eight consecutive 7-day buckets of findings split by severity, oldest first. */
  findingsTrend: WeeklyFindingsPoint[];
  /** Total detections in the eight weeks immediately before the visible window. */
  findingsTrendPreviousTotal: number;
}

// =============================================================================
// PLUGIN MANAGEMENT
// =============================================================================

export type PluginCategory =
  | 'Authentication' | 'Authorization' | 'Headers' | 'Injection'
  | 'API Design' | 'Performance' | 'Infrastructure' | 'Compliance'
  | 'AI' | 'Cloud' | 'GraphQL' | 'gRPC' | 'SOAP';

export type PluginExecutionStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'SKIPPED';

export interface PluginConfigField {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  default?: any;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
  required?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription?: string;
  author: string;
  category: PluginCategory;
  owaspMappings: string[];
  cweIds: string[];
  tags: string[];
  isBuiltin: boolean;
  isEnabled: boolean;
  configSchema?: { fields: PluginConfigField[] };
  defaultConfig?: Record<string, any>;
  userConfig?: Record<string, any> | null;
  permissions: string[];
  documentationUrl?: string;
  changelog?: string;
  license: string;
  stats?: {
    totalExecutions: number;
    avgDurationMs: number;
    successRate?: number;
    findingsBySeverity?: Record<string, number>;
  };
  recentExecutions?: PluginExecution[];
  createdAt: string;
  updatedAt: string;
}

export interface PluginExecution {
  id: string;
  pluginId: string;
  assessmentId?: string;
  userId: string;
  status: PluginExecutionStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  findingsCount: number;
  errorMessage?: string;
  createdAt: string;
}

export interface ScanProfile {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  userId?: string;
  isSystem: boolean;
  enabledPlugins: string[];
  pluginConfigs?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SinglePluginRunResult {
  pluginId: string;
  pluginName: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  findingsCount: number;
  durationMs: number;
  findings: any[];
  error?: string;
  executionId: string;
}

// =============================================================================

export interface ScanProgress {
  step: string;
  stepIndex: number;
  totalSteps: number;
  progress: number;
  message: string;
  findingsCount: number;
  currentPlugin?: string;
  completed?: boolean;
  error?: string;
}

// =============================================================================
// Finance — estimated AI usage cost (real token usage x static rate table)
// =============================================================================

export interface AiUsageEvent {
  id: string;
  assessmentId: string;
  projectId: string;
  project?: { id: string; name: string };
  provider: string;
  model?: string;
  status: string;
  tokensUsed: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface FinanceCostByProvider {
  provider: string;
  tokensUsed: number;
  costUsd: number;
  count: number;
}

export interface FinanceTrendPoint {
  month: string; // YYYY-MM
  costUsd: number;
}

export interface FinanceSummary {
  totalEstimatedCostUsd: number;
  totalTokensUsed: number;
  assessmentsWithAi: number;
  avgCostPerAssessment: number;
  byProvider: FinanceCostByProvider[];
  trend: FinanceTrendPoint[];
}

export interface FinanceUsagePage {
  items: AiUsageEvent[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── OWASP coverage & system information ──────────────────────────────────────
//
// Mirrors `apps/api/src/modules/plugins/owasp-coverage.ts` and
// `apps/api/src/modules/system/system.service.ts`. Coverage describes which
// categories have a check behind them — never how many findings were produced.

export type OwaspCoverageStatus = 'COVERED' | 'NOT_COVERED';

export interface OwaspCategoryCoverage {
  id: string;
  shortId: string;
  title: string;
  description: string;
  status: OwaspCoverageStatus;
  checkIds: string[];
  checkNames: string[];
  ruleCount: number;
  /** Why nothing covers this category. Present only when NOT_COVERED. */
  gapReason?: string;
  /**
   * What the covering checks cannot reach. Present only when COVERED, and only
   * where "covered" would otherwise be read as "exhaustively tested".
   */
  scopeNote?: string;
}

export interface OwaspCoverageSummary {
  edition: '2023';
  categories: OwaspCategoryCoverage[];
  coveredCount: number;
  totalCount: number;
  /** e.g. "10/10". */
  label: string;
  checkCount: number;
  ruleCount: number;
}

export interface SystemCheckState {
  id: string;
  name: string;
  category: string;
  owaspMappings: string[];
  ruleCount: number;
  isEnabled: boolean;
}

export interface SystemInfo {
  product: { name: string; version: string; tagline: string; domain: string };
  runtime: {
    apiFramework: string;
    bunVersion: string | null;
    nodeVersion: string;
    uptimeSeconds: number;
    environment: string;
  };
  securityChecks: {
    total: number;
    enabled: number;
    totalRules: number;
    checks: SystemCheckState[];
  };
  owasp: OwaspCoverageSummary;
}

// ─── Scoring: snapshot, explanation and comparison ────────────────────────────
//
// Mirrors `apps/api/src/modules/scoring/score-engine.ts`. A score is never read
// without its status: UNAVAILABLE means no measurement exists (never 0, never
// 100), PROVISIONAL means a real measurement over incomplete coverage.

export type ScoreStatusValue = 'UNAVAILABLE' | 'PROVISIONAL' | 'FINAL';

export interface ScoreCoverage {
  plannedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  skippedChecks: number;
  executionErrors: number;
}

export interface RulePenalty {
  pluginId: string;
  ruleId: string;
  aggregationKey: string;
  highestSeverity: string;
  severityWeight: number;
  fingerprints: string[];
  fingerprintCount: number;
  affectedComponents: string[];
  distinctAffectedComponents: number;
  exposureMultiplier: number;
  rulePenalty: number;
  /** Title of the rule as reported by the check, when available. */
  title?: string;
}

export interface ScoreExplanation {
  scoreVersion: string;
  securityScore: number | null;
  scoreStatus: ScoreStatusValue;
  coveragePercent: number | null;
  totalPenalty: number;
  uncappedPenalty: number;
  severityBreakdown: Record<string, number>;
  rulePenalties: RulePenalty[];
  /** Why the score is PROVISIONAL or UNAVAILABLE. Empty when FINAL. */
  reasons: string[];
  weights: Record<string, number>;
  issuesConsidered: number;
  coverage: ScoreCoverage;
}

export interface AssessmentScore {
  assessmentId: string;
  status: string;
  securityScore: number | null;
  scoreStatus: ScoreStatusValue;
  scoreVersion: string | null;
  scoreComputedAt: string | null;
  coveragePercent: number | null;
  coverage: ScoreCoverage;
  explanation: ScoreExplanation | null;
}

/**
 * A scan that may serve as a comparison baseline.
 *
 * Score fields are nested under `summary` because the service selects them via
 * a Prisma relation include — they are NOT flattened onto the candidate. Read
 * them as `candidate.summary?.securityScore`; the first version of this type
 * flattened them by mistake and every option in the baseline picker rendered
 * "—/100".
 */
export interface ComparisonCandidate {
  id: string;
  createdAt: string;
  summary: {
    securityScore: number | null;
    scoreStatus: ScoreStatusValue;
    scoreVersion: string | null;
    coveragePercent: number | null;
  } | null;
}

// ─── Scan comparison ──────────────────────────────────────────────────────────
//
// Mirrors `apps/api/src/modules/scoring/comparison.service.ts`. The change kinds
// are deliberately more than "fixed / not fixed": an issue absent from the later
// scan is only RESOLVED when the check that would have found it ran to
// completion. Otherwise it is NOT_TESTED or OUT_OF_SCOPE.

export type Comparability = 'COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';

export type IssueChangeKind =
  | 'NEW'
  | 'PERSISTING'
  | 'RESOLVED'
  | 'REOPENED'
  | 'NOT_TESTED'
  | 'OUT_OF_SCOPE';

export interface ComparisonChangeEntry {
  fingerprint: string;
  issueId: string;
  title: string;
  severity: string;
  pluginId: string;
  ruleId: string;
  /** Pre-joined "METHOD /path". */
  route: string;
  severityChangedFrom?: string;
}

export interface ComparisonSide {
  assessmentId: string;
  createdAt: string;
  securityScore: number | null;
  scoreStatus: ScoreStatusValue;
  scoreVersion: string | null;
  coveragePercent: number | null;
  plannedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  skippedChecks: number;
}

/**
 * Check-scope difference between the two scans.
 *
 * Field names mirror `assessComparability` in `comparison.service.ts` exactly.
 * They are the basis for "not retested" versus "resolved": a check present in
 * the baseline but absent from the current scan cannot prove anything was
 * fixed.
 */
export interface ComparisonScopeChanges {
  sharedChecks: string[];
  addedChecks: string[];
  removedChecks: string[];
}

export interface ScanComparison {
  comparability: Comparability;
  warnings: string[];
  current: ComparisonSide;
  baseline: ComparisonSide | null;
  scoreDelta: number | null;
  coverageDelta: number | null;
  changes: Record<IssueChangeKind, ComparisonChangeEntry[]>;
  scopeChanges: ComparisonScopeChanges | null;
}


/** Minimal user projection returned by `GET /users/assignable`. */
export interface AssignableUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

/** Aggregates from `GET /issues/stats`. Prisma groupBy shape, kept verbatim. */
export interface IssueStats {
  bySeverity: { severity: string; _count: { _all: number } }[];
  byStatus: { status: string; _count: { _all: number } }[];
  byOwasp: { owaspCategory: string; _count: { _all: number } }[];
  total: number;
  open: number;
}

// ─── AI security guidance ─────────────────────────────────────────────────────
//
// Mirrors `apps/api/src/modules/ai/guidance/security-guidance.schema.ts`.
// Guidance is ADVISORY. It never modifies severity, status or scanner evidence,
// and the UI must always render it as visually distinct from evidence.

export type GuidanceStatus = 'READY' | 'FAILED' | 'SKIPPED' | 'UNAVAILABLE';
export type ContextConfidence = 'DETECTED' | 'USER_CONFIGURED' | 'INFERRED' | 'UNKNOWN';
export type GuidancePriority = 'IMMEDIATE' | 'SHORT_TERM' | 'PLANNED';

export interface RemediationStep {
  title: string;
  description: string;
}

export interface EnvironmentGuidance {
  technology: string;
  basis: ContextConfidence;
  guidance: string;
  example?: string;
}

export interface GuidanceReference {
  title: string;
  source: string;
  url?: string;
}

export interface SecurityGuidance {
  schemaVersion: string;
  summary: string;
  rootCause: string;
  businessImpact: string;
  technicalImpact: string;
  remediation: { priority: GuidancePriority; steps: RemediationStep[] };
  environmentGuidance: EnvironmentGuidance[];
  verification: { steps: string[]; expectedResult: string };
  falsePositiveConsiderations: string[];
  references: GuidanceReference[];
  confidence: number | null;
}

export interface GuidanceMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  knowledgeVersion: string;
  schemaVersion: string;
  playbookIds: string[];
  confidence: number | null;
  generatedAt: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
}

export interface IssueGuidanceResponse {
  status: GuidanceStatus;
  reason: string | null;
  guidance: SecurityGuidance | null;
  metadata?: GuidanceMetadata;
}

export interface AiUsageByProvider {
  provider: string;
  model: string;
  count: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
}

export interface AiUsageSummary {
  totalEnrichments: number;
  succeeded: number;
  failed: number;
  skipped: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
  averageCostPerEnrichment: number | null;
  byProvider: AiUsageByProvider[];
  failureBreakdown: { errorCode: string; count: number }[];
  pricingTableVersion: string;
  costIsEstimated: true;
}
