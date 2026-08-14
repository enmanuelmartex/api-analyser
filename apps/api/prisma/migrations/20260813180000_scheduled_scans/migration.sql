-- Scheduled scans: recurring automatic assessments.
--
-- Purely additive. Two new tables, four new enums, and two nullable columns on
-- `assessments`. Nothing existing is dropped, renamed or rewritten:
--
--   • `assessments.trigger` defaults to MANUAL, which is the truth for every
--     row written before scheduling existed.
--   • `assessments.scheduleId` is nullable with ON DELETE SET NULL, so deleting
--     a schedule detaches the scans it produced instead of cascading away the
--     findings and reports that hang off them.

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "AssessmentTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

CREATE TYPE "ScheduleFrequency" AS ENUM ('ONCE', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

CREATE TYPE "ScheduleExecutionStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'
);

-- ── scheduled_scans ──────────────────────────────────────────────────────────

CREATE TABLE "scheduled_scans" (
  "id"                     TEXT              NOT NULL,
  "name"                   TEXT              NOT NULL,
  "projectId"              TEXT              NOT NULL,
  "createdById"            TEXT,

  "frequency"              "ScheduleFrequency" NOT NULL,
  "timezone"               TEXT              NOT NULL DEFAULT 'UTC',
  "hour"                   INTEGER,
  "minute"                 INTEGER,
  "intervalHours"          INTEGER,
  "weekdays"               INTEGER[]         NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "monthDay"               INTEGER,
  "cronExpression"         TEXT,
  "startAt"                TIMESTAMP(3),

  "executionMode"          TEXT              NOT NULL DEFAULT 'all',
  "scanProfileId"          TEXT,
  "manualPlugins"          TEXT[]            NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enableAiAnalysis"       BOOLEAN           NOT NULL DEFAULT true,
  "maxRequestsPerEndpoint" INTEGER           NOT NULL DEFAULT 10,
  "requestDelayMs"         INTEGER           NOT NULL DEFAULT 200,
  "timeoutMs"              INTEGER           NOT NULL DEFAULT 10000,

  "status"                 "ScheduleStatus"  NOT NULL DEFAULT 'ACTIVE',
  "skipIfRunning"          BOOLEAN           NOT NULL DEFAULT true,
  "nextRunAt"              TIMESTAMP(3),
  "lastRunAt"              TIMESTAMP(3),
  "totalRuns"              INTEGER           NOT NULL DEFAULT 0,
  "consecutiveFailures"    INTEGER           NOT NULL DEFAULT 0,

  "createdAt"              TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3)      NOT NULL,

  CONSTRAINT "scheduled_scans_pkey" PRIMARY KEY ("id")
);

-- The scheduler's hot path, run once a minute: "which schedules are due?".
CREATE INDEX "scheduled_scans_status_nextRunAt_idx" ON "scheduled_scans" ("status", "nextRunAt");
CREATE INDEX "scheduled_scans_projectId_idx" ON "scheduled_scans" ("projectId");

ALTER TABLE "scheduled_scans"
  ADD CONSTRAINT "scheduled_scans_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_scans"
  ADD CONSTRAINT "scheduled_scans_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduled_scans"
  ADD CONSTRAINT "scheduled_scans_scanProfileId_fkey"
  FOREIGN KEY ("scanProfileId") REFERENCES "scan_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── schedule_executions ──────────────────────────────────────────────────────

CREATE TABLE "schedule_executions" (
  "id"           TEXT                      NOT NULL,
  "scheduleId"   TEXT                      NOT NULL,
  "assessmentId" TEXT,
  "status"       "ScheduleExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledFor" TIMESTAMP(3)              NOT NULL,
  "startedAt"    TIMESTAMP(3),
  "finishedAt"   TIMESTAMP(3),
  "trigger"      "AssessmentTrigger"       NOT NULL DEFAULT 'SCHEDULED',
  "reason"       TEXT,
  "createdAt"    TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)              NOT NULL,

  CONSTRAINT "schedule_executions_pkey" PRIMARY KEY ("id")
);

-- The duplicate guard. `scheduledFor` is derived from the recurrence rule, so
-- two API instances racing on the same occurrence compute the same instant and
-- the loser's INSERT fails here instead of starting a second scan.
CREATE UNIQUE INDEX "schedule_executions_scheduleId_scheduledFor_key"
  ON "schedule_executions" ("scheduleId", "scheduledFor");

CREATE INDEX "schedule_executions_scheduleId_scheduledFor_idx"
  ON "schedule_executions" ("scheduleId", "scheduledFor");

CREATE INDEX "schedule_executions_status_idx" ON "schedule_executions" ("status");

ALTER TABLE "schedule_executions"
  ADD CONSTRAINT "schedule_executions_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "scheduled_scans" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedule_executions"
  ADD CONSTRAINT "schedule_executions_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "assessments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── assessments: provenance ──────────────────────────────────────────────────

ALTER TABLE "assessments"
  ADD COLUMN "trigger"    "AssessmentTrigger" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "scheduleId" TEXT;

-- The skipIfRunning guard reads this: "is a scan from this schedule in flight?"
CREATE INDEX "assessments_scheduleId_status_idx" ON "assessments" ("scheduleId", "status");

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "scheduled_scans" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
