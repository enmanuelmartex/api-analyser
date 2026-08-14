-- Observability: rich audit/application logs, in-app notifications, runtime settings.
--
-- Written by hand rather than generated because `audit_logs.event` is NOT NULL
-- and the table already has rows. The column is added nullable, backfilled from
-- the existing `action` verb, and only then constrained — a generated migration
-- would have added it NOT NULL in one step and failed on any non-empty table.

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "LogSeverity" AS ENUM ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL');

CREATE TYPE "LogCategory" AS ENUM (
  'AUTHENTICATION', 'USERS', 'PROJECTS', 'SCANS', 'FINDINGS', 'REPORTS',
  'CONFIGURATION', 'SECURITY', 'SYSTEM', 'API', 'WORKER', 'DATABASE', 'NOTIFICATIONS'
);

CREATE TYPE "LogStatus" AS ENUM ('SUCCESS', 'FAILED', 'WARNING');

CREATE TYPE "NotificationType" AS ENUM (
  'SCAN_COMPLETED', 'SCAN_FAILED', 'REPORT_GENERATED',
  'SECURITY_WARNING', 'CRITICAL_FINDING', 'SYSTEM_ERROR'
);

CREATE TYPE "NotificationCategory" AS ENUM ('SCANS', 'REPORTS', 'SECURITY', 'SYSTEM');

-- ── audit_logs: widen into a full event record ───────────────────────────────

ALTER TABLE "audit_logs"
  ADD COLUMN "event"        TEXT,
  ADD COLUMN "severity"     "LogSeverity" NOT NULL DEFAULT 'INFO',
  ADD COLUMN "category"     "LogCategory" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "status"       "LogStatus"   NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "message"      TEXT,
  ADD COLUMN "source"       TEXT,
  ADD COLUMN "httpMethod"   TEXT,
  ADD COLUMN "route"        TEXT,
  ADD COLUMN "statusCode"   INTEGER,
  ADD COLUMN "requestId"    TEXT,
  ADD COLUMN "durationMs"   INTEGER,
  ADD COLUMN "projectId"    TEXT,
  ADD COLUMN "assessmentId" TEXT,
  ADD COLUMN "reportId"     TEXT,
  ADD COLUMN "errorCode"    TEXT,
  ADD COLUMN "stackTrace"   TEXT;

-- Backfill. Historical rows keep their meaning: the event name is derived from
-- the resource and the CRUD verb they were written with, and the status mirrors
-- the `success` flag those rows already carry.
UPDATE "audit_logs"
SET "event" = "resource" || '.' || lower("action"::TEXT)
WHERE "event" IS NULL;

UPDATE "audit_logs"
SET "status"   = 'FAILED',
    "severity" = 'WARNING'
WHERE "success" = FALSE;

-- Category is a best-effort classification of the pre-existing rows. Anything
-- unrecognised stays SYSTEM rather than being guessed at.
UPDATE "audit_logs" SET "category" = 'AUTHENTICATION' WHERE "resource" IN ('auth', 'session');
UPDATE "audit_logs" SET "category" = 'USERS'          WHERE "resource" IN ('user', 'invitation');
UPDATE "audit_logs" SET "category" = 'PROJECTS'       WHERE "resource" = 'project';
UPDATE "audit_logs" SET "category" = 'SCANS'          WHERE "resource" = 'assessment';
UPDATE "audit_logs" SET "category" = 'REPORTS'        WHERE "resource" = 'report';
UPDATE "audit_logs" SET "category" = 'FINDINGS'       WHERE "resource" IN ('issue', 'finding');

ALTER TABLE "audit_logs" ALTER COLUMN "event" SET NOT NULL;

-- `action` becomes optional: worker and system events are not CRUD operations,
-- and writing a placeholder verb onto them would make the column meaningless.
ALTER TABLE "audit_logs" ALTER COLUMN "action" DROP NOT NULL;

-- Indexes for the filters the log explorer actually issues. Each is a composite
-- ending in createdAt because every query is "filter, then newest first".
CREATE INDEX "audit_logs_severity_createdAt_idx"  ON "audit_logs" ("severity", "createdAt");
CREATE INDEX "audit_logs_category_createdAt_idx"  ON "audit_logs" ("category", "createdAt");
CREATE INDEX "audit_logs_event_createdAt_idx"     ON "audit_logs" ("event", "createdAt");
CREATE INDEX "audit_logs_requestId_idx"           ON "audit_logs" ("requestId");
CREATE INDEX "audit_logs_assessmentId_idx"        ON "audit_logs" ("assessmentId");

-- ── notifications ────────────────────────────────────────────────────────────

CREATE TABLE "notifications" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "type"       "NotificationType"     NOT NULL,
  "category"   "NotificationCategory" NOT NULL,
  "severity"   "LogSeverity"          NOT NULL DEFAULT 'INFO',
  "title"      TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "entityType" TEXT,
  "entityId"   TEXT,
  "href"       TEXT,
  "read"       BOOLEAN NOT NULL DEFAULT FALSE,
  "readAt"     TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_read_createdAt_idx" ON "notifications" ("userId", "read", "createdAt");
CREATE INDEX "notifications_userId_createdAt_idx"      ON "notifications" ("userId", "createdAt");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── notification_preferences ─────────────────────────────────────────────────

CREATE TABLE "notification_preferences" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "scanCompleted"   BOOLEAN NOT NULL DEFAULT TRUE,
  "scanFailed"      BOOLEAN NOT NULL DEFAULT TRUE,
  "reportGenerated" BOOLEAN NOT NULL DEFAULT TRUE,
  "securityWarning" BOOLEAN NOT NULL DEFAULT TRUE,
  "criticalFinding" BOOLEAN NOT NULL DEFAULT TRUE,
  "systemError"     BOOLEAN NOT NULL DEFAULT TRUE,
  "soundEnabled"    BOOLEAN NOT NULL DEFAULT FALSE,
  "desktopEnabled"  BOOLEAN NOT NULL DEFAULT FALSE,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences" ("userId");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── system_settings ──────────────────────────────────────────────────────────

CREATE TABLE "system_settings" (
  "key"         TEXT NOT NULL,
  "value"       JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- ── Drop the email-invitation system ─────────────────────────────────────────
--
-- The flow never sent mail: there is no SMTP transport in this product, so an
-- invitation only ever produced a link an administrator had to deliver by hand.
-- Creating the account directly is strictly less work and was already fully
-- implemented next to it.

DROP TABLE IF EXISTS "invitations";
