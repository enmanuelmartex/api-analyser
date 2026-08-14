-- Automatic scan reports, richer notifications, and outbound email.
--
-- Three related changes:
--   1. `reports` gains a generation lifecycle (status/error/attempts) and a
--      provenance field (kind), so an automatic PDF can be queued, retried and
--      seen to have failed instead of silently not existing.
--   2. `notifications` gains the types and the ISSUES category the sidebar
--      badges and the grouped-findings notification need.
--   3. `email_deliveries` records every outbound message so delivery is
--      idempotent across job retries.
--
-- The backfill at the bottom is the part that matters on an existing install:
-- automatic PDF generation already ran before this migration, so the reports it
-- produced must be claimed as automatic. Without that, the first scan completed
-- after deploying would generate a *second* PDF for every historical scan that
-- gets re-run, which is precisely the duplication `autoKey` exists to prevent.

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('AUTOMATIC_SCAN_REPORT', 'MANUAL_EXPORT', 'SCHEDULED_REPORT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'ISSUES';

-- AlterEnum
-- Six values added to one enum. Safe in a single transaction on PostgreSQL 12+
-- (the compose file pins postgres:16) provided none of the new values is *used*
-- before the transaction commits — and none is: the backfill below touches only
-- `reports`, whose enums are created fresh above rather than altered.
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'NEW_FINDINGS';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_SCAN_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_SCAN_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_REPORT_SENT';
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_REPORT_FAILED';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "emailCriticalFinding" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailReportGenerated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailScanCompleted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailScanFailed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "newFindings" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reportFailed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
-- `status` defaults to COMPLETED so every pre-existing row keeps describing
-- itself accurately: all of them were written synchronously by a code path that
-- only ever inserted after rendering.
ALTER TABLE "reports" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autoKey" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "kind" "ReportKind" NOT NULL DEFAULT 'MANUAL_EXPORT',
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'COMPLETED';

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_idempotencyKey_key" ON "email_deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "email_deliveries_entityType_entityId_idx" ON "email_deliveries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "email_deliveries_userId_createdAt_idx" ON "email_deliveries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Ownership first: every report already belongs to whoever owns the project
-- behind its assessment. Deriving it once here is what lets the application
-- read `requestedById` directly instead of joining three tables on every row.
UPDATE "reports" r
SET "requestedById" = p."userId"
FROM "assessments" a
JOIN "projects" p ON p."id" = a."projectId"
WHERE r."assessmentId" = a."id";

-- Then provenance. A TECHNICAL PDF is what the pre-existing automatic path
-- produced, so the earliest one per assessment is claimed as the automatic
-- report. `DISTINCT ON` picks exactly one row per assessment, which is what
-- the unique index on `autoKey` requires — a scan that also has a hand-made
-- TECHNICAL PDF keeps the later one as a manual export rather than failing the
-- migration.
--
-- Ordered by version then generatedAt then id: version is the meaningful
-- ordering, and id breaks ties so the choice is deterministic on re-run.
WITH first_technical_pdf AS (
    SELECT DISTINCT ON (r."assessmentId")
        r."id",
        r."assessmentId"
    FROM "reports" r
    WHERE r."type" = 'TECHNICAL' AND r."format" = 'PDF'
    ORDER BY r."assessmentId", r."version" ASC, r."generatedAt" ASC, r."id" ASC
)
UPDATE "reports" r
SET "kind" = 'AUTOMATIC_SCAN_REPORT',
    "autoKey" = f."assessmentId"
FROM first_technical_pdf f
WHERE r."id" = f."id";

-- CreateIndex
-- Created after the backfill: building it first would make the UPDATE above
-- fail on any install that already had two TECHNICAL PDFs for one assessment.
CREATE UNIQUE INDEX "reports_autoKey_key" ON "reports"("autoKey");
