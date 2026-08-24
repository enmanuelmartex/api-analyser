-- Removes outbound email entirely: no more Resend, no more hosted relay, no
-- more PDF-by-email. In-app notifications are untouched — they were always the
-- primary channel, email was only ever an addition on top of them.

-- Drop notifications of the two types that existed solely to report on an
-- email's own delivery outcome. Nothing produces them once the pipeline that
-- emitted `email.sent` / `email.failed` is gone.
DELETE FROM "notifications" WHERE "type" IN ('EMAIL_REPORT_SENT', 'EMAIL_REPORT_FAILED');

-- AlterEnum
-- PostgreSQL cannot drop an enum value directly, so the type is rebuilt
-- without the two removed members and the column is repointed to it.
CREATE TYPE "NotificationType_new" AS ENUM (
    'SCAN_COMPLETED',
    'SCAN_FAILED',
    'REPORT_GENERATED',
    'REPORT_FAILED',
    'SECURITY_WARNING',
    'CRITICAL_FINDING',
    'NEW_FINDINGS',
    'SCHEDULED_SCAN_COMPLETED',
    'SCHEDULED_SCAN_FAILED',
    'SYSTEM_ERROR'
);
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";

-- DropForeignKey
ALTER TABLE "email_deliveries" DROP CONSTRAINT "email_deliveries_userId_fkey";

-- DropTable
DROP TABLE "email_deliveries";

-- DropEnum
DROP TYPE "EmailDeliveryStatus";

-- AlterTable
-- Per-user email preferences. The in-app switches above them are unaffected.
ALTER TABLE "notification_preferences"
  DROP COLUMN "emailEnabled",
  DROP COLUMN "emailScanCompleted",
  DROP COLUMN "emailScanFailed",
  DROP COLUMN "emailReportGenerated",
  DROP COLUMN "emailCriticalFinding",
  DROP COLUMN "emailWeeklySummary";
