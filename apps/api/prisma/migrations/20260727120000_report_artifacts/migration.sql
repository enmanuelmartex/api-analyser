-- Report artifacts: persisted, immutable, de-duplicated.
--
-- Before this migration a report row was created by GET
-- /reports/assessment/:id/generate, which the UI also used as its "Download"
-- action. Every download therefore inserted another row with the same
-- (assessmentId, type, format) and no artifact attached. This migration
-- persists the artifact and makes the duplicate insert impossible.

-- 1. Artifact columns.
ALTER TABLE "reports" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "reports" ADD COLUMN "fileName" TEXT;
ALTER TABLE "reports" ADD COLUMN "generatorVersion" TEXT;

-- `content` was declared but never written by any code path. Renaming it keeps
-- whatever a fork may have stored, and gives the column the meaning the
-- download path now relies on: the frozen document source.
ALTER TABLE "reports" RENAME COLUMN "content" TO "sourceSnapshot";

-- 2. Reconcile existing duplicates WITHOUT deleting user data.
--
-- Historical rows are versioned in generation order: the first artifact of a
-- (assessment, type, format) keeps version 1, each later duplicate becomes 2,
-- 3, ... They remain queryable as history; the reports list shows only the
-- latest version of each artifact unless history is explicitly requested.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "assessmentId", "type", "format"
      ORDER BY "generatedAt" ASC, "id" ASC
    ) AS rn
  FROM "reports"
)
UPDATE "reports" r
SET "version" = ranked.rn
FROM ranked
WHERE r."id" = ranked."id";

-- 3. The duplicate guard. Concurrent generations of the same artifact now
--    collide here instead of both inserting.
CREATE UNIQUE INDEX "reports_assessmentId_type_format_version_key"
  ON "reports" ("assessmentId", "type", "format", "version");
