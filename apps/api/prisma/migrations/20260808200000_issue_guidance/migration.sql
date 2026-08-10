-- AI security guidance, stored separately from scanner evidence.
--
-- Guidance was previously computed in memory during a scan and attached to the
-- in-flight finding objects. It reached the report renderer and then vanished:
-- nothing persisted it, so the Issues screens could never show it and the same
-- analysis was paid for again on every regeneration.
--
-- Additive only. No existing table is altered and no data is rewritten.

CREATE TYPE "GuidanceStatus" AS ENUM ('READY', 'FAILED', 'SKIPPED');

CREATE TABLE "issue_guidance" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "status" "GuidanceStatus" NOT NULL,
    "payload" JSONB,
    "errorCode" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "knowledgeVersion" TEXT NOT NULL,
    "playbookIds" TEXT[],
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_guidance_pkey" PRIMARY KEY ("id")
);

-- One current guidance per issue: regeneration replaces, it does not accumulate.
CREATE UNIQUE INDEX "issue_guidance_issueId_key" ON "issue_guidance"("issueId");

-- Usage roll-ups group by provider over a time range.
CREATE INDEX "issue_guidance_provider_generatedAt_idx" ON "issue_guidance"("provider", "generatedAt");

-- "Which enrichments failed" is a routine operational question.
CREATE INDEX "issue_guidance_status_idx" ON "issue_guidance"("status");

-- Cascade: guidance about a deleted issue is meaningless.
ALTER TABLE "issue_guidance"
  ADD CONSTRAINT "issue_guidance_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "security_issues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
